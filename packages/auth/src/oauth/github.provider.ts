import { z } from 'zod';
import type { OAuthUserProfile } from '../types.js';
import type { OAuthHttpClient } from './http-client.js';
import {
  OAuthExchangeError,
  type AuthorizationUrlParams,
  type ExchangeCodeParams,
  type OAuthProvider,
  type OAuthProviderCredentials,
} from './oauth-provider.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';
const SCOPES = ['read:user', 'user:email'];
// GitHub rejects API requests without a User-Agent.
const USER_AGENT = 'engram-auth';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

const userResponseSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullish(),
  email: z.string().nullish(),
});

const emailEntrySchema = z.object({
  email: z.string(),
  primary: z.boolean(),
  verified: z.boolean(),
});

export class GitHubOAuthProvider implements OAuthProvider {
  readonly name = 'github' as const;

  constructor(
    private readonly credentials: OAuthProviderCredentials,
    private readonly http: OAuthHttpClient
  ) {}

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const query = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: params.redirectUri,
      scope: SCOPES.join(' '),
      state: params.state,
      allow_signup: 'false',
    });
    return `${AUTHORIZE_URL}?${query.toString()}`;
  }

  async exchangeCodeForProfile(params: ExchangeCodeParams): Promise<OAuthUserProfile> {
    const tokenRes = await this.http.postForm(TOKEN_URL, {
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    });
    if (!tokenRes.ok) {
      throw new OAuthExchangeError(this.name, `Token exchange failed (status ${tokenRes.status})`);
    }
    const token = tokenResponseSchema.safeParse(tokenRes.body);
    if (!token.success) {
      throw new OAuthExchangeError(this.name, 'No access token in response');
    }

    const authHeaders = {
      Authorization: `Bearer ${token.data.access_token}`,
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.github+json',
    };

    const userRes = await this.http.getJson(USER_URL, authHeaders);
    if (!userRes.ok) {
      throw new OAuthExchangeError(this.name, `Profile fetch failed (status ${userRes.status})`);
    }
    const user = userResponseSchema.safeParse(userRes.body);
    if (!user.success) {
      throw new OAuthExchangeError(this.name, 'Unexpected profile shape');
    }

    const email = await this.resolveEmail(user.data.email ?? null, authHeaders);
    if (!email) {
      throw new OAuthExchangeError(this.name, 'No verified primary email available');
    }

    return {
      provider: this.name,
      providerAccountId: String(user.data.id),
      email,
      name: user.data.name ?? user.data.login,
    };
  }

  /**
   * GitHub omits the email from `/user` when it is private. Fall back to the
   * `/user/emails` endpoint and pick the primary, verified address.
   */
  private async resolveEmail(
    publicEmail: string | null,
    headers: Record<string, string>
  ): Promise<string | null> {
    if (publicEmail) {
      return publicEmail;
    }
    const res = await this.http.getJson(EMAILS_URL, headers);
    if (!res.ok) {
      return null;
    }
    const parsed = z.array(emailEntrySchema).safeParse(res.body);
    if (!parsed.success) {
      return null;
    }
    const primary = parsed.data.find((e) => e.primary && e.verified);
    if (primary) {
      return primary.email;
    }
    const anyVerified = parsed.data.find((e) => e.verified);
    return anyVerified ? anyVerified.email : null;
  }
}
