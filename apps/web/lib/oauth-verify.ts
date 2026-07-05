/**
 * Whether a claim-carrying OIDC provider asserts the account's email is
 * verified.
 *
 * - Google: the OIDC `email_verified` claim on the ID-token profile — the
 *   authoritative per-email verification signal.
 * - Providers without such a claim (notably GitHub, whose `/user` profile email
 *   carries no verification flag) are verified out-of-band via
 *   {@link isGithubEmailVerified} and fail closed here.
 *
 * Unknown providers default to false (fail closed). Kept in its own module so
 * it is unit-testable without loading auth.ts (which initialises NextAuth and
 * pulls in `next/server`).
 */
export function isProviderEmailVerified(provider: string | undefined, profile: unknown): boolean {
  const p = (profile ?? {}) as Record<string, unknown>;
  if (provider === 'google') return p.email_verified === true;
  return false;
}

interface GithubEmailEntry {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

/**
 * Default-deny GitHub email verification (#206).
 *
 * GitHub's `/user` profile email carries no verification flag, so presence of a
 * public email is not proof it is verified. Resolve the account's addresses via
 * `/user/emails` and require that `email` appears there with `verified: true`.
 * Any failure — missing token/email, non-2xx response, malformed body, network
 * error, or no matching verified entry — denies. GitHub is already a hard
 * dependency of the OAuth handshake itself, so this fail-closed call adds no new
 * availability surface. `fetchImpl` is injectable so the path is unit-testable.
 */
export async function isGithubEmailVerified(
  email: string | null | undefined,
  accessToken: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (!email || !accessToken) return false;
  try {
    const res = await fetchImpl('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'engram-dashboard',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return false;
    const target = email.toLowerCase();
    return body.some((row) => {
      const entry = (row ?? {}) as GithubEmailEntry;
      return (
        entry.verified === true &&
        typeof entry.email === 'string' &&
        entry.email.toLowerCase() === target
      );
    });
  } catch {
    return false;
  }
}
