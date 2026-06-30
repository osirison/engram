import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  JwtService,
  OAuthService,
  SessionService,
  type OAuthProviderName,
  type OAuthUserProfile,
} from '@engram/auth';
import { AuthResolver } from './auth-resolver.service';
import { UserService } from './user.service';

/** DI token carrying the base URL used to build OAuth callback URLs. */
export const OAUTH_REDIRECT_BASE_URL = Symbol.for('engram.oauth-redirect-base');

/**
 * Scopes granted to an interactive session established via OAuth — full control
 * over the user's own memories (read/write/delete), but not `admin`.
 */
const SESSION_SCOPES = ['memories:read', 'memories:write', 'memories:delete'];

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

function isProviderName(value: string): value is OAuthProviderName {
  return value === 'github' || value === 'google';
}

/**
 * HTTP OAuth login endpoints. Mounts under `/auth`:
 *   - `GET  /auth/:provider/login`    → redirect to the provider with CSRF state
 *   - `GET  /auth/:provider/callback` → exchange code, upsert user, issue JWT + session
 *   - `GET  /auth/me`                 → resolve the caller's identity
 *   - `POST /auth/logout`             → destroy a session
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oauth: OAuthService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly users: UserService,
    private readonly resolver: AuthResolver,
    @Inject(OAUTH_REDIRECT_BASE_URL) private readonly redirectBase: string,
  ) {}

  private providerOrThrow(name: string): OAuthProviderName {
    if (!isProviderName(name) || !this.oauth.isEnabled(name)) {
      throw new NotFoundException(`OAuth provider "${name}" is not enabled`);
    }
    return name;
  }

  private callbackUri(provider: OAuthProviderName): string {
    return `${this.redirectBase}/auth/${provider}/callback`;
  }

  @Get(':provider/login')
  async login(
    @Param('provider') providerName: string,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.providerOrThrow(providerName);
    const state = await this.sessions.createOAuthState(provider);
    const url = this.oauth.getProvider(provider).getAuthorizationUrl({
      state,
      redirectUri: this.callbackUri(provider),
    });
    res.redirect(url);
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') providerName: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const provider = this.providerOrThrow(providerName);

    const parsed = callbackQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('Missing OAuth code or state');
    }
    const { code, state } = parsed.data;

    // One-time, provider-bound state check (CSRF + replay protection).
    const stateData = await this.sessions.consumeOAuthState(state);
    if (!stateData || stateData.provider !== provider) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    let profile: OAuthUserProfile;
    try {
      profile = await this.oauth.getProvider(provider).exchangeCodeForProfile({
        code,
        redirectUri: this.callbackUri(provider),
      });
    } catch {
      this.logger.warn(`oauth_exchange_failed provider=${provider}`);
      throw new UnauthorizedException('OAuth authentication failed');
    }

    const user = await this.users.upsertByEmail(profile.email);
    const token = this.jwt.issue({
      userId: user.id,
      email: user.email,
      organizationId: user.organizationId,
      scopes: SESSION_SCOPES,
    });
    const sessionId = await this.sessions.createSession({
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      scopes: SESSION_SCOPES,
    });

    res.cookie('engram_session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: this.jwt.tokenLifetimeSeconds * 1000,
    });

    this.logger.log(`oauth_login_ok provider=${provider} userId=${user.id}`);
    return {
      token,
      tokenType: 'Bearer',
      expiresIn: this.jwt.tokenLifetimeSeconds,
      sessionId,
      user: {
        id: user.id,
        email: user.email,
        organizationId: user.organizationId,
      },
    };
  }

  @Get('me')
  async me(@Req() req: Request): Promise<unknown> {
    const outcome = await this.resolver.authenticate(req.headers);
    if (outcome.status !== 'authenticated') {
      throw new UnauthorizedException();
    }
    return { user: outcome.identity };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown): Promise<void> {
    const sessionId =
      body &&
      typeof body === 'object' &&
      typeof (body as { sessionId?: unknown }).sessionId === 'string'
        ? (body as { sessionId: string }).sessionId
        : undefined;
    if (sessionId) {
      await this.sessions.destroySession(sessionId);
    }
  }
}
