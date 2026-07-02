/**
 * Whether an OAuth provider asserts the account's email is verified.
 *
 * - Google: the OIDC `email_verified` claim on the ID token profile.
 * - GitHub: the `/user` profile does not carry verification, but GitHub only
 *   ever returns a *verified* primary email as `profile.email`; when the
 *   primary is unverified the field is null, so a present email is trustworthy.
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
