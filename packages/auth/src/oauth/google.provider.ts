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

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SCOPES = ['openid', 'email', 'profile'];

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

const userInfoSchema = z.object({
  id: z.string(),
  email: z.string(),
  verified_email: z.boolean().nullish(),
  name: z.string().nullish(),
});

export class GoogleOAuthProvider implements OAuthProvider {
  readonly name = 'google' as const;

  constructor(
    private readonly credentials: OAuthProviderCredentials,
    private readonly http: OAuthHttpClient
  ) {}

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const query = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state: params.state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `${AUTHORIZE_URL}?${query.toString()}`;
  }

  async exchangeCodeForProfile(params: ExchangeCodeParams): Promise<OAuthUserProfile> {
    const tokenRes = await this.http.postForm(TOKEN_URL, {
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    });
    if (!tokenRes.ok) {
      throw new OAuthExchangeError(this.name, `Token exchange failed (status ${tokenRes.status})`);
    }
    const token = tokenResponseSchema.safeParse(tokenRes.body);
    if (!token.success) {
      throw new OAuthExchangeError(this.name, 'No access token in response');
    }

    const userRes = await this.http.getJson(USERINFO_URL, {
      Authorization: `Bearer ${token.data.access_token}`,
    });
    if (!userRes.ok) {
      throw new OAuthExchangeError(this.name, `Profile fetch failed (status ${userRes.status})`);
    }
    const user = userInfoSchema.safeParse(userRes.body);
    if (!user.success) {
      throw new OAuthExchangeError(this.name, 'Unexpected profile shape');
    }
    // Default-deny: only an explicit `verified_email === true` is trusted.
    // A missing/null field must not be treated as verified, or an account
    // whose email is unverified could be mapped onto an existing user.
    if (user.data.verified_email !== true) {
      throw new OAuthExchangeError(this.name, 'Google email is not verified');
    }

    return {
      provider: this.name,
      providerAccountId: user.data.id,
      email: user.data.email,
      name: user.data.name ?? null,
    };
  }
}
