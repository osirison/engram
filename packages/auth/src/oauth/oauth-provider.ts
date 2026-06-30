import type { OAuthProviderName, OAuthUserProfile } from '../types.js';

/** Parameters for building a provider authorization-redirect URL. */
export interface AuthorizationUrlParams {
  /** Opaque CSRF token; echoed back on the callback and verified one-time. */
  state: string;
  /** Absolute callback URL registered with the provider. */
  redirectUri: string;
}

/** Parameters for exchanging an authorization code for a user profile. */
export interface ExchangeCodeParams {
  code: string;
  redirectUri: string;
}

/** OAuth credentials for a single provider. */
export interface OAuthProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * An OAuth 2.0 authorization-code provider that can build a login redirect and
 * turn a returned `code` into a normalised {@link OAuthUserProfile}.
 */
export interface OAuthProvider {
  readonly name: OAuthProviderName;
  /** Build the URL to redirect the user-agent to for consent. */
  getAuthorizationUrl(params: AuthorizationUrlParams): string;
  /** Exchange an authorization code for the authenticated user's profile. */
  exchangeCodeForProfile(params: ExchangeCodeParams): Promise<OAuthUserProfile>;
}

/** Raised when a provider exchange fails (network, bad code, missing email). */
export class OAuthExchangeError extends Error {
  constructor(
    public readonly provider: OAuthProviderName,
    message: string
  ) {
    super(message);
    this.name = 'OAuthExchangeError';
  }
}
