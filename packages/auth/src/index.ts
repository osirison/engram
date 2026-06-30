/**
 * @engram/auth — authentication & authorization primitives for ENGRAM.
 *
 * Framework-agnostic building blocks (plain classes + interfaces). The NestJS
 * wiring, Redis store adapters, and HTTP controller live in the host app
 * (`apps/mcp-server/src/auth`), which composes these with config and DI.
 */

export type { AuthMethod, AuthIdentity, OAuthProviderName, OAuthUserProfile } from './types.js';

export {
  JwtService,
  JwtError,
  type JwtErrorCode,
  type JwtClaims,
  type JwtIssueInput,
  type JwtServiceOptions,
} from './jwt/jwt.service.js';

export { OAuthService } from './oauth/oauth.service.js';
export {
  OAuthExchangeError,
  type OAuthProvider,
  type OAuthProviderCredentials,
  type AuthorizationUrlParams,
  type ExchangeCodeParams,
} from './oauth/oauth-provider.js';
export { GitHubOAuthProvider } from './oauth/github.provider.js';
export { GoogleOAuthProvider } from './oauth/google.provider.js';
export {
  FetchOAuthHttpClient,
  type OAuthHttpClient,
  type OAuthHttpResponse,
} from './oauth/http-client.js';

export {
  SessionService,
  type SessionData,
  type OAuthStateData,
  type SessionServiceOptions,
} from './session/session.service.js';
export { type SessionStore } from './session/session-store.js';

export {
  RateLimitService,
  type RateLimitRule,
  type RateLimitOptions,
  type ConsumeParams,
  type RateLimitResult,
} from './ratelimit/rate-limit.service.js';
export {
  type RateLimitStore,
  type RateLimitIncrementResult,
} from './ratelimit/rate-limit-store.js';
