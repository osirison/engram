/**
 * Centralised, server-only access to the dashboard's environment.
 *
 * Keeping every `process.env` read in one module means there is a single place
 * to document configuration, and the `eslint-plugin-turbo` allow-list in
 * `turbo.json` stays in sync with what the app actually consumes.
 *
 * Do not import this from client components — it is only safe on the server.
 */

function readBool(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normaliseUrl(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/\/+$/, '');
}

/**
 * Per-operator tenant binding (WP2 T9/D11). Parses
 * `ENGRAM_OPERATOR_TENANTS="alice@x.com:qp|ci-bot;bob@x.com:*"` into a map of
 * lower-cased operator email → allowed data-owner userIds (or `'*'` for any).
 * Unset/empty ⇒ empty map ⇒ every operator manages every tenant (zero-config,
 * preserving the single-operator default). Malformed segments are skipped
 * defensively rather than throwing at boot.
 */
export function parseOperatorTenants(value: string | undefined): Map<string, string[] | '*'> {
  const map = new Map<string, string[] | '*'>();
  if (!value) return map;
  for (const segment of value.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue; // no email, or empty email — skip
    const email = trimmed.slice(0, idx).trim().toLowerCase();
    const rhs = trimmed.slice(idx + 1).trim();
    if (!email || !rhs) continue;
    if (rhs === '*') {
      map.set(email, '*');
      continue;
    }
    const tenants = rhs
      .split('|')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tenants.length > 0) map.set(email, tenants);
  }
  return map;
}

export const serverEnv = {
  /**
   * Postgres connection string for the dashboard's read/analytics path. Prefer
   * a dedicated read-only role via `WEB_DATABASE_URL` (writes go through the MCP
   * server, so the dashboard never needs write access — see #206); fall back to
   * the shared full-privilege `DATABASE_URL` when it is not set.
   */
  databaseUrl: process.env.WEB_DATABASE_URL ?? process.env.DATABASE_URL ?? null,

  /** Base URL of the ENGRAM MCP server, e.g. http://localhost:3000. */
  mcpUrl: normaliseUrl(process.env.ENGRAM_MCP_URL),

  /** Service API key (memories:read/write/delete) used for MCP writes + recall. */
  mcpApiKey: process.env.ENGRAM_API_KEY ?? null,

  /**
   * Lower-cased allow-list of operator emails permitted to sign in. When empty
   * the console is open to any successful OAuth login — intended for local and
   * single-tenant deployments only.
   */
  adminEmails: readList(process.env.ENGRAM_ADMIN_EMAILS),

  /** Default data-owner userId pre-selected in the navigator. */
  defaultUserId: process.env.ENGRAM_DEFAULT_USER_ID ?? null,

  /**
   * Optional per-operator tenant binding (WP2 T9/D11). Empty map ⇒ every
   * operator may manage every data owner (current zero-config behaviour).
   */
  operatorTenants: parseOperatorTenants(process.env.ENGRAM_OPERATOR_TENANTS),

  /**
   * Enables the passwordless email development credentials provider. Requires
   * the explicit flag AND `NODE_ENV === 'development'`. This is an allow-list,
   * not a `!== 'production'` deny-list: staging, preview, and unset-NODE_ENV
   * environments must NOT expose passwordless impersonation just because they
   * are "not production".
   */
  devAuthEnabled:
    readBool(process.env.ENGRAM_DASHBOARD_DEV_AUTH) && process.env.NODE_ENV === 'development',

  isProduction: process.env.NODE_ENV === 'production',
} as const;

/**
 * An email is an operator when the allow-list contains it. An empty allow-list
 * means "open" — but only outside production: a production deploy that forgets
 * to set ENGRAM_ADMIN_EMAILS fails closed rather than admitting any OAuth login.
 */
export function isAllowedOperator(email: string | null | undefined): boolean {
  if (serverEnv.adminEmails.length === 0) return !serverEnv.isProduction;
  if (!email) return false;
  return serverEnv.adminEmails.includes(email.toLowerCase());
}

/**
 * The data owners an operator may manage (WP2 T9). Returns `'*'` (any) when no
 * binding is configured for this operator — the zero-config default — or the
 * explicit list from `ENGRAM_OPERATOR_TENANTS`.
 */
export function allowedTenantsFor(email: string | null | undefined): '*' | string[] {
  if (serverEnv.operatorTenants.size === 0) return '*';
  if (!email) return [];
  const binding = serverEnv.operatorTenants.get(email.toLowerCase());
  if (binding === undefined) return []; // bindings exist but not for this operator
  return binding;
}

/** Whether `email` may manage data owner `userId` (WP2 T9). */
export function canOperatorManageUser(email: string | null | undefined, userId: string): boolean {
  const allowed = allowedTenantsFor(email);
  return allowed === '*' || allowed.includes(userId);
}
