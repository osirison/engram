import { isFlagEnabled } from './auth/auth.config';

export interface HttpAuthPostureInput {
  /** From the resolved deployment-profile capabilities. */
  multiTenant: boolean;
  /** Effective MCP transport (`stdio` | `streamable-http`). */
  transport: string;
  /** Effective auth enforcement (already transport-scoped by the caller). */
  authRequired: boolean;
  /** Raw `ALLOW_UNAUTHENTICATED_HTTP` env value (boot-validated flag). */
  allowUnauthenticatedHttp: string | undefined;
}

/**
 * Fail-safe against the most dangerous misconfiguration: an HTTP transport
 * serving every tenant unauthenticated (userId taken from tool input, not a
 * credential). Only meaningful on a multi-tenant profile — memory/lite are
 * single-user, so there is no cross-tenant data to expose.
 *
 * G1-T1: applies in EVERY NODE_ENV, not just production — the tenant boundary
 * does not depend on the environment label, so running unauthenticated must
 * always be an explicit operator acknowledgement
 * (`ALLOW_UNAUTHENTICATED_HTTP=true`).
 *
 * @returns the refusal message when boot must be aborted, `null` otherwise.
 */
export function unauthenticatedHttpRefusal(
  input: HttpAuthPostureInput,
): string | null {
  const { multiTenant, transport, authRequired, allowUnauthenticatedHttp } =
    input;
  if (
    !multiTenant ||
    transport !== 'streamable-http' ||
    authRequired ||
    isFlagEnabled(allowUnauthenticatedHttp)
  ) {
    return null;
  }
  return (
    'Refusing to start: multi-tenant streamable-http without AUTH_REQUIRED=true. ' +
    'This would serve all tenants unauthenticated with a client-controlled userId. ' +
    'Set AUTH_REQUIRED=true (recommended), or set ALLOW_UNAUTHENTICATED_HTTP=true to ' +
    'acknowledge a trusted-network deployment.'
  );
}
