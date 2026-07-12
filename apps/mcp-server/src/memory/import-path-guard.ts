/**
 * Server-side path allowlist for the `import_agent_memory` MCP tool (A18).
 *
 * The admin token authorizes WHO may run an import, not WHICH paths the
 * server will read — without this guard an admin token could point the
 * import adapters at arbitrary server files (`/etc/passwd`, other tenants'
 * exports, …). Every import — including `dryRun` — must resolve its `path`
 * inside an allowed root:
 *
 *   - `IMPORT_ALLOWED_ROOT` (validated by `@engram/config` to be an absolute
 *     path) when set;
 *   - the server process home directory (`os.homedir()`) otherwise.
 *
 * Both the root and the requested path are resolved with `fs.realpath`, so
 * `..` traversal AND symlink escapes are caught. Containment is decided with
 * `path.relative`, never naive string prefixing (`/home/qp2` must not pass
 * for root `/home/qp`).
 */
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';
import { ClientFacingError } from '../security/client-error.util';

/**
 * Effective allowlist root: `IMPORT_ALLOWED_ROOT` when set (non-blank),
 * otherwise the server process home directory.
 */
export function resolveAllowedImportRoot(): string {
  const configured = process.env.IMPORT_ALLOWED_ROOT;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured;
  }
  return homedir();
}

/**
 * Assert that `requestedPath` resolves (symlinks included) to a location
 * inside `allowedRoot`. Throws a {@link ClientFacingError} — the same error
 * surface as the controller's other tool-validation failures — when the path
 * does not exist, the root does not exist, or the path escapes the root.
 *
 * @returns the fully resolved real path (useful for logging).
 */
export async function assertImportPathAllowed(
  requestedPath: string,
  allowedRoot: string = resolveAllowedImportRoot(),
): Promise<string> {
  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(allowedRoot);
  } catch {
    throw new ClientFacingError(
      `Import root '${allowedRoot}' does not exist on the server; set IMPORT_ALLOWED_ROOT to an existing absolute directory`,
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch {
    throw new ClientFacingError(
      `Import path '${requestedPath}' does not exist on the server`,
    );
  }

  // `relative()` containment check: an escaping path yields `..`(+separator)
  // or, across drives on Windows, an absolute path. A result of '' means the
  // path IS the root, which is allowed.
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ClientFacingError(
      `Import path '${requestedPath}' resolves outside the allowed import root '${resolvedRoot}'; only paths under that root can be imported (configure IMPORT_ALLOWED_ROOT to change it)`,
    );
  }

  return resolvedPath;
}
