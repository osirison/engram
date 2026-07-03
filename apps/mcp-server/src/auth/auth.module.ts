import {
  Module,
  type DynamicModule,
  type Provider,
  type Type,
} from '@nestjs/common';
import {
  JwtRevocationService,
  JwtService,
  OAuthService,
  SessionService,
} from '@engram/auth';
import { RedisModule } from '@engram/redis';
import type { ProfileCapabilities } from '@engram/config';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthController, OAUTH_REDIRECT_BASE_URL } from './auth.controller';
import { AuthResolver } from './auth-resolver.service';
import { UserService } from './user.service';
import { RedisSessionStore } from './redis-session.store';
import { RedisRateLimitStore } from './redis-rate-limit.store';
import { McpAuthMiddleware } from './mcp-auth.middleware';
import { McpRateLimitMiddleware } from './mcp-rate-limit.middleware';
import {
  buildOAuthProviders,
  isAuthRequired,
  oauthRedirectBaseUrl,
  parseJwtConfig,
  parseRateLimitConfig,
} from './auth.config';

/**
 * Authentication & multi-tenancy wiring for the MCP server (Epic E4).
 *
 * Profile-gated: imported by `app.module` only when the profile has a database
 * (lite + enterprise). JWT verification and API-key auth need only Postgres, so
 * they are available in `lite`; OAuth login, Redis-backed sessions, and rate
 * limiting require Redis and are wired only in `enterprise`.
 */
@Module({})
export class AuthModule {
  static forRoot(capabilities: ProfileCapabilities): DynamicModule {
    const jwtConfig = parseJwtConfig();
    const redisEnabled = capabilities.requiresRedis;
    const rateLimitConfig = parseRateLimitConfig();

    const imports: Array<Type<unknown> | DynamicModule> = [ApiKeysModule];
    if (redisEnabled) {
      imports.push(RedisModule.forRoot());
    }

    const providers: Provider[] = [UserService, AuthResolver];
    const exports: Array<Type<unknown> | symbol> = [AuthResolver, UserService];
    const controllers: Array<Type<unknown>> = [];

    // JWT signing/verification — only when a secret is configured.
    if (jwtConfig) {
      providers.push({
        provide: JwtService,
        useFactory: (): JwtService =>
          new JwtService({
            secret: jwtConfig.secret,
            expiresInSeconds: jwtConfig.expiresInSeconds,
          }),
      });
      exports.push(JwtService);
    }

    // /mcp auth resolution + enforcement (works with API keys and/or JWT).
    providers.push({
      provide: McpAuthMiddleware,
      useFactory: (resolver: AuthResolver): McpAuthMiddleware =>
        new McpAuthMiddleware(resolver, isAuthRequired()),
      inject: [AuthResolver],
    });
    exports.push(McpAuthMiddleware);

    if (redisEnabled) {
      providers.push(RedisSessionStore, RedisRateLimitStore);

      providers.push({
        provide: SessionService,
        useFactory: (store: RedisSessionStore): SessionService =>
          new SessionService(store, {
            sessionTtlSeconds: jwtConfig?.expiresInSeconds,
          }),
        inject: [RedisSessionStore],
      });
      providers.push({
        provide: OAuthService,
        useFactory: (): OAuthService => new OAuthService(buildOAuthProviders()),
      });
      providers.push({
        provide: OAUTH_REDIRECT_BASE_URL,
        useValue: oauthRedirectBaseUrl(),
      });
      exports.push(SessionService, OAuthService);

      // Rate-limit middleware — only when explicitly enabled.
      if (rateLimitConfig.enabled) {
        providers.push({
          provide: McpRateLimitMiddleware,
          useFactory: (store: RedisRateLimitStore): McpRateLimitMiddleware =>
            new McpRateLimitMiddleware(store, rateLimitConfig),
          inject: [RedisRateLimitStore],
        });
        exports.push(McpRateLimitMiddleware);
      }

      // OAuth login endpoints require both sessions (Redis) and JWT issuance.
      // The jti denylist (JWT revocation on logout) shares the Redis session
      // store; without Redis (lite profile) JWTs are not revocable and the
      // AuthResolver skips the denylist check.
      if (jwtConfig) {
        providers.push({
          provide: JwtRevocationService,
          useFactory: (store: RedisSessionStore): JwtRevocationService =>
            new JwtRevocationService(store),
          inject: [RedisSessionStore],
        });
        exports.push(JwtRevocationService);
        controllers.push(AuthController);
      }
    }

    return { module: AuthModule, imports, controllers, providers, exports };
  }
}
