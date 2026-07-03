/**
 * JWT revocation via a `jti` denylist.
 *
 * JWTs are stateless: once issued, an HS256 token verifies until `exp`
 * (7 days by default) no matter what happens server-side. This service makes
 * individual tokens revocable by recording their `jti` in a denylist store
 * (Redis in the host app) with a TTL equal to the token's *remaining*
 * lifetime — the entry expires exactly when the token itself would, so the
 * denylist never grows beyond the set of still-live revoked tokens.
 *
 * Failure posture: `isRevoked`/`assertNotRevoked` deliberately let store
 * errors propagate. Callers on the authentication path (e.g. the host app's
 * `AuthResolver`) treat any error as *invalid* — fail-closed — matching the
 * API-key posture where a verification error never authenticates. A store
 * outage therefore degrades JWT auth rather than silently accepting a
 * possibly-revoked token.
 */

import { JwtError, type JwtClaims } from './jwt.service.js';

const DENYLIST_PREFIX = 'auth:jwt:denylist:';

/**
 * Key/value store backing the `jti` denylist. Structurally a subset of
 * `SessionStore`, so the host's Redis session store satisfies it as-is.
 * Every write carries an explicit TTL so entries cannot leak.
 */
export interface JwtDenylistStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class JwtRevocationService {
  constructor(private readonly store: JwtDenylistStore) {}

  /**
   * Revoke a token by denylisting its `jti` for the token's remaining
   * lifetime (`exp - atSeconds`). Returns `false` without writing when the
   * token is already expired (nothing left to revoke) or carries no `jti`.
   */
  async revoke(
    claims: Pick<JwtClaims, 'jti' | 'exp'>,
    atSeconds: number = nowSeconds()
  ): Promise<boolean> {
    const remainingSeconds = claims.exp - atSeconds;
    if (!claims.jti || remainingSeconds <= 0) {
      return false;
    }
    await this.store.set(DENYLIST_PREFIX + claims.jti, String(atSeconds), remainingSeconds);
    return true;
  }

  /**
   * Whether a `jti` has been revoked. An empty `jti` reports revoked
   * (fail-closed); store errors propagate to the caller.
   */
  async isRevoked(jti: string): Promise<boolean> {
    if (!jti) {
      return true;
    }
    return (await this.store.get(DENYLIST_PREFIX + jti)) !== null;
  }

  /** Throw {@link JwtError} (`code: 'revoked'`) when the `jti` is denylisted. */
  async assertNotRevoked(jti: string): Promise<void> {
    if (await this.isRevoked(jti)) {
      throw new JwtError('revoked', 'Token has been revoked');
    }
  }
}
