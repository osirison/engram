/**
 * Whether an OAuth provider asserts the account's email is verified.
 *
 * - Google: the OIDC `email_verified` claim on the ID token profile — the
 *   authoritative per-email verification signal.
 * - GitHub: the `/user` profile's `email` is the account's *public* email and
 *   does not itself carry a verification flag, so this is a best-effort check
 *   (presence of a public email) rather than a hard verification guarantee.
 *   Treat it as one layer: sign-in is still gated by the operator allow-list
 *   (`ENGRAM_ADMIN_EMAILS`), which is the real authorization boundary. For a
 *   strict GitHub check, resolve the primary address via `/user/emails` and
 *   require its `verified` flag.
 *
 * Unknown providers default to false (fail closed). Kept in its own module so
 * it is unit-testable without loading auth.ts (which initialises NextAuth and
 * pulls in `next/server`).
 */
export function isProviderEmailVerified(
  provider: string | undefined,
  profile: unknown,
): boolean {
  const p = (profile ?? {}) as Record<string, unknown>;
  if (provider === 'google') return p.email_verified === true;
  if (provider === 'github') return typeof p.email === 'string' && p.email.length > 0;
  return false;
}
