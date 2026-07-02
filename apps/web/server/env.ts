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

export const serverEnv = {
  /** Postgres connection string — shared with the rest of the monorepo. */
  databaseUrl: process.env.DATABASE_URL ?? null,

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
