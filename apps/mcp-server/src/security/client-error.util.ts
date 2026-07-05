import { ZodError } from 'zod';

/**
 * An error whose message was deliberately written for MCP clients.
 *
 * Tool handlers wrap every failure via {@link toClientError} before rethrowing,
 * and that wrapper only forwards messages from two sources:
 *
 *   1. Zod validation errors — they describe the client's own input.
 *   2. `ClientFacingError` — messages we authored for the caller (auth
 *      failures, unavailable-in-profile notices, …).
 *
 * Everything else (Prisma, Redis, embedding-provider, vector-store errors)
 * is replaced with a generic message so internal details — connection
 * strings, table names, provider quotas — never reach a client. The full
 * error is still logged server-side by the handler before rethrowing.
 */
export class ClientFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientFacingError';
  }
}

/** Generic client-facing detail used when the underlying error is internal. */
export const GENERIC_CLIENT_ERROR_DETAIL =
  'an internal error occurred (details are in the server logs)';

/**
 * Convert an arbitrary caught error into one that is safe to surface to an
 * MCP client. `prefix` names the failed operation (e.g. `Failed to create
 * memory`); the detail is only included for validation errors and errors we
 * explicitly marked as client-facing.
 */
export function toClientError(error: unknown, prefix: string): Error {
  if (error instanceof ZodError) {
    const detail = error.issues.map((issue) => issue.message).join('; ');
    return new Error(`${prefix}: ${detail}`);
  }
  if (error instanceof ClientFacingError) {
    return new Error(`${prefix}: ${error.message}`);
  }
  return new Error(`${prefix}: ${GENERIC_CLIENT_ERROR_DETAIL}`);
}
