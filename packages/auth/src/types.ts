/**
 * Shared authentication types for ENGRAM.
 *
 * These describe an authenticated principal independent of *how* it was
 * authenticated (interactive JWT session vs. programmatic API key). The
 * resolved {@link AuthIdentity} is what the MCP request pipeline trusts when
 * deriving the acting tenant — never the `userId` supplied in tool input.
 */

/** How a principal proved its identity on a request. */
export type AuthMethod = 'jwt' | 'api-key';

/**
 * A resolved, trusted principal for a single request.
 *
 * `userId` is the tenant boundary: all memory operations are scoped to it.
 * `organizationId` enables org-level scoping/quotas when present.
 */
export interface AuthIdentity {
  userId: string;
  organizationId: string | null;
  email: string | null;
  scopes: string[];
  method: AuthMethod;
  /**
   * The API key id when authenticated via a key, else null. Lets rate limiting
   * meter per-key (not just per-user) so two keys for one user have independent
   * budgets.
   */
  apiKeyId: string | null;
}

/** OAuth providers ENGRAM can authenticate against. */
export type OAuthProviderName = 'github' | 'google';

/**
 * Normalised user profile returned by an OAuth provider after a successful
 * authorization-code exchange. `email` is required because it is the stable
 * key ENGRAM uses to upsert a {@link AuthIdentity.userId}.
 */
export interface OAuthUserProfile {
  provider: OAuthProviderName;
  /** Provider-specific stable account id (e.g. GitHub numeric id). */
  providerAccountId: string;
  email: string;
  name: string | null;
}
