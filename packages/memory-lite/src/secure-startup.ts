import { chmod, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { decodeEncryptionKey, generateEncryptionKeyBase64, KEY_LENGTH_BYTES } from './encryption';

/**
 * Owner-only file modes enforced for profile-lite persistence.
 *
 * Directory: `0o700` (rwx for owner only).
 * File:      `0o600` (rw for owner only).
 */
export const OWNER_ONLY_DIR_MODE = 0o700;
export const OWNER_ONLY_FILE_MODE = 0o600;

/**
 * Logger channel for the secure-startup checks. Uses NestJS's logger so
 * output is consistent with the rest of the application and is captured by
 * the global pino redaction policy.
 */
const secureStartupLogger = new Logger('MemoryLiteSecureStartup');

/**
 * Resolved runtime options for the secure-startup checks.
 *
 * All fields can be derived from the environment; the explicit interface
 * keeps the helper testable without globals.
 */
export interface SecureStartupOptions {
  /** Absolute path to the local data directory. */
  readonly dataDir: string;
  /** AES-256 key (decoded) — undefined when insecure mode is enabled. */
  readonly encryptionKey: Buffer | undefined;
  /** True when plaintext persistence is explicitly enabled. */
  readonly insecureMode: boolean;
  /** NODE_ENV value used to refuse insecure mode in production. */
  readonly nodeEnv: 'development' | 'production' | 'test';
}

/**
 * Resolve {@link SecureStartupOptions} from the process environment.
 *
 * This function is pure (it does not touch the filesystem) so callers can
 * run it inside tests or build pipelines without needing a writable home
 * directory.
 */
export function resolveSecureStartupOptions(
  env: NodeJS.ProcessEnv = process.env
): SecureStartupOptions {
  const nodeEnvRaw = env['NODE_ENV'] ?? 'development';
  const nodeEnv: 'development' | 'production' | 'test' =
    nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development';

  const insecureMode = env['LOCAL_INSECURE_MODE'] === 'true';

  const dataDirRaw = env['LOCAL_DATA_DIR'];
  const dataDir =
    typeof dataDirRaw === 'string' && dataDirRaw.length > 0
      ? path.resolve(dataDirRaw)
      : path.join(os.homedir(), '.engram', 'data');

  let encryptionKey: Buffer | undefined;
  const rawKey = env['LOCAL_ENCRYPTION_KEY'];
  if (insecureMode) {
    encryptionKey = undefined;
  } else if (typeof rawKey === 'string' && rawKey.length > 0) {
    encryptionKey = decodeEncryptionKey(rawKey);
  } else if (nodeEnv !== 'production') {
    // Development convenience: derive an ephemeral key so the operator can
    // iterate without provisioning credentials. The warning is emitted by
    // {@link assertSecureStartup}.
    encryptionKey = decodeEncryptionKey(generateEncryptionKeyBase64());
  } else {
    encryptionKey = undefined; // Production startup will fail explicitly.
  }

  return {
    dataDir,
    encryptionKey,
    insecureMode,
    nodeEnv,
  };
}

/**
 * Verify that `mode` is no more permissive than `OWNER_ONLY_DIR_MODE`.
 *
 * World- and group-readable directories would let any local process read
 * memory payloads, so we reject them outright.
 */
export function isDirModeAcceptable(mode: number): boolean {
  // Mask the owner-only bits we care about. Group/world reads are the
  // primary concern; group/world execute is also rejected because the dir
  // only needs to be traversable by the owner for normal operation.
  const permissiveBits = 0o077;
  return (mode & permissiveBits) === 0;
}

/**
 * Verify that `mode` is no more permissive than `OWNER_ONLY_FILE_MODE`.
 *
 * Symlinks are reported as acceptable because the target file's mode is
 * what actually controls access; we resolve through the symlink when
 * validating permissions of a file on disk.
 */
export function isFileModeAcceptable(mode: number): boolean {
  const permissiveBits = 0o077;
  return (mode & permissiveBits) === 0;
}

/**
 * Run the profile-lite secure-startup checklist.
 *
 * Steps:
 *  1. Refuse `LOCAL_INSECURE_MODE=true` when `NODE_ENV=production`.
 *  2. Refuse startup when no encryption key is configured in production.
 *  3. Ensure the data dir exists with `0o700` permissions.
 *  4. Reject startup if existing data files have permissive modes.
 *  5. Emit a loud warning when insecure mode is active (development only).
 *
 * Returns the resolved options so the caller can hand them to the
 * {@link LiteJsonStore} constructor without re-reading the environment.
 */
export async function assertSecureStartup(
  options: SecureStartupOptions = resolveSecureStartupOptions()
): Promise<SecureStartupOptions> {
  if (options.insecureMode) {
    if (options.nodeEnv === 'production') {
      throw new Error(
        'LOCAL_INSECURE_MODE=true is rejected in production. ' +
          'Set LOCAL_ENCRYPTION_KEY (base64 32 bytes) and unset LOCAL_INSECURE_MODE.'
      );
    }
    secureStartupLogger.warn(
      '!! LOCAL_INSECURE_MODE=true — profile-lite will persist PLAINTEXT memory payloads. ' +
        'This mode is for local development only and is refused when NODE_ENV=production.'
    );
  } else if (!options.encryptionKey) {
    throw new Error(
      'Profile-lite requires LOCAL_ENCRYPTION_KEY (base64-encoded 32-byte AES-256 key) ' +
        'when LOCAL_INSECURE_MODE is not enabled.'
    );
  } else if (options.nodeEnv !== 'production') {
    secureStartupLogger.warn(
      'Derived an ephemeral AES-256 key for development. ' +
        'Set LOCAL_ENCRYPTION_KEY explicitly for reproducible encryption.'
    );
  }

  await ensureDataDirectory(options.dataDir);
  await auditExistingPermissions(options.dataDir);

  if (options.insecureMode) {
    secureStartupLogger.warn(
      `Plaintext persistence active at ${options.dataDir}. ` +
        'Run `chmod 0700 <dir> && find <dir> -type f -exec chmod 0600 {} +` to tighten.'
    );
  } else {
    secureStartupLogger.log(
      `Profile-lite secure store ready at ${options.dataDir} (encrypted, mode 0700).`
    );
  }

  return options;
}

/**
 * Create the data directory if it does not exist, and tighten its
 * permissions to {@link OWNER_ONLY_DIR_MODE}.
 */
export async function ensureDataDirectory(dataDir: string): Promise<void> {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
    // mkdir's `mode` is masked by umask; re-apply to guarantee the bits we
    // care about (and reject perms later if a hostile umask still leaks).
    await chmod(dataDir, OWNER_ONLY_DIR_MODE);
    return;
  }

  const stats = await stat(dataDir);
  if (!stats.isDirectory()) {
    throw new Error(
      `LOCAL_DATA_DIR is not a directory: ${dataDir} (mode=${stats.mode.toString(8)})`
    );
  }

  if (!isDirModeAcceptable(stats.mode)) {
    throw new Error(
      `Refusing to start: LOCAL_DATA_DIR ${dataDir} has permissive mode ${stats.mode.toString(8)}. ` +
        `Run \`chmod 0700 ${dataDir}\` and restart.`
    );
  }
}

/**
 * Walk the data directory and reject startup if any existing file has
 * permissions broader than {@link OWNER_ONLY_FILE_MODE}.
 *
 * Sub-directories that exist alongside the data root (for example, the
 * `memories/` shard root) are also audited against
 * {@link OWNER_ONLY_DIR_MODE}.
 */
export async function auditExistingPermissions(dataDir: string): Promise<void> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dataDir, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(dataDir, entry.name);
    const stats = await stat(target);
    if (entry.isDirectory()) {
      if (!isDirModeAcceptable(stats.mode)) {
        throw new Error(
          `Refusing to start: directory ${target} has permissive mode ${stats.mode.toString(8)}. ` +
            `Run \`chmod 0700 ${target}\` and restart.`
        );
      }
      await auditExistingPermissions(target);
      continue;
    }
    if (entry.isFile()) {
      if (!isFileModeAcceptable(stats.mode)) {
        throw new Error(
          `Refusing to start: file ${target} has permissive mode ${stats.mode.toString(8)}. ` +
            `Run \`chmod 0600 ${target}\` and restart.`
        );
      }
    }
  }
}

/**
 * Re-export of {@link KEY_LENGTH_BYTES} for convenience in callers that
 * need to validate the key size without importing the encryption module
 * directly.
 */
export { KEY_LENGTH_BYTES };
