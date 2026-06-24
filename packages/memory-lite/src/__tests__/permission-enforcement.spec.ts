import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assertSecureStartup,
  auditExistingPermissions,
  ensureDataDirectory,
  isDirModeAcceptable,
  isFileModeAcceptable,
  OWNER_ONLY_DIR_MODE,
  OWNER_ONLY_FILE_MODE,
  resolveSecureStartupOptions,
} from '../secure-startup';
import { decodeEncryptionKey, generateEncryptionKeyBase64 } from '../encryption';

function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `engram-lite-${prefix}-`));
}

/**
 * Skips permission-sensitive assertions when the process cannot chown /
 * chmod the target. We only skip individual assertions rather than the
 * whole file so that the rest of the suite still exercises the public
 * surface in restricted environments (e.g. some CI containers).
 */
const canTightenPerms = process.getuid !== undefined;

describe('memory-lite permission enforcement', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = makeTempDir('secure-startup');
  });

  afterEach(() => {
    if (workDir && canTightenPerms) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  describe('mode helpers', () => {
    it('accepts owner-only directory modes', () => {
      expect(isDirModeAcceptable(OWNER_ONLY_DIR_MODE)).toBe(true);
      expect(isDirModeAcceptable(0o711)).toBe(false);
      expect(isDirModeAcceptable(0o755)).toBe(false);
    });

    it('accepts owner-only file modes', () => {
      expect(isFileModeAcceptable(OWNER_ONLY_FILE_MODE)).toBe(true);
      expect(isFileModeAcceptable(0o644)).toBe(false);
      expect(isFileModeAcceptable(0o664)).toBe(false);
    });
  });

  describe('ensureDataDirectory', () => {
    it('creates a missing directory with owner-only mode', async () => {
      if (!canTightenPerms) return;
      const target = path.join(workDir, 'fresh');
      await ensureDataDirectory(target);
      const { stat } = await import('node:fs/promises');
      const stats = await stat(target);
      expect(stats.isDirectory()).toBe(true);
      expect(isDirModeAcceptable(stats.mode)).toBe(true);
    });

    it('rejects a pre-existing permissive directory', async () => {
      if (!canTightenPerms) return;
      const target = path.join(workDir, 'permissive');
      await mkdir(target, { recursive: true });
      await chmod(target, 0o755);
      await expect(ensureDataDirectory(target)).rejects.toThrow(/permissive mode/);
    });

    it('rejects when the target exists but is not a directory', async () => {
      if (!canTightenPerms) return;
      const target = path.join(workDir, 'a-file');
      await writeFile(target, 'hello', { encoding: 'utf8', mode: OWNER_ONLY_FILE_MODE });
      await chmod(target, OWNER_ONLY_FILE_MODE);
      await expect(ensureDataDirectory(target)).rejects.toThrow(/not a directory/);
    });
  });

  describe('auditExistingPermissions', () => {
    it('passes when every nested entry is owner-only', async () => {
      if (!canTightenPerms) return;
      const target = path.join(workDir, 'shard');
      await mkdir(target, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
      await chmod(target, OWNER_ONLY_DIR_MODE);
      const file = path.join(target, 'memory.json');
      await writeFile(file, '{}', {
        encoding: 'utf8',
        mode: OWNER_ONLY_FILE_MODE,
      });
      await chmod(file, OWNER_ONLY_FILE_MODE);
      await expect(auditExistingPermissions(target)).resolves.toBeUndefined();
    });

    it('rejects a file with permissive mode', async () => {
      if (!canTightenPerms) return;
      const target = path.join(workDir, 'shard');
      await mkdir(target, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
      await chmod(target, OWNER_ONLY_DIR_MODE);
      const file = path.join(target, 'memory.json');
      await writeFile(file, '{}', { encoding: 'utf8' });
      await chmod(file, 0o644);
      await expect(auditExistingPermissions(target)).rejects.toThrow(/permissive mode/);
    });
  });

  describe('assertSecureStartup', () => {
    it('refuses insecure mode in production', async () => {
      await expect(
        assertSecureStartup({
          dataDir: workDir,
          encryptionKey: undefined,
          insecureMode: true,
          nodeEnv: 'production',
        })
      ).rejects.toThrow(/rejected in production/);
    });

    it('refuses to start when no key is provided in production', async () => {
      await expect(
        assertSecureStartup({
          dataDir: workDir,
          encryptionKey: undefined,
          insecureMode: false,
          nodeEnv: 'production',
        })
      ).rejects.toThrow(/LOCAL_ENCRYPTION_KEY/);
    });

    it('creates the data dir and resolves when given a valid key', async () => {
      if (!canTightenPerms) return;
      const target = path.join(workDir, 'data');
      const result = await assertSecureStartup({
        dataDir: target,
        encryptionKey: decodeEncryptionKey(generateEncryptionKeyBase64()),
        insecureMode: false,
        nodeEnv: 'test',
      });
      expect(result.dataDir).toBe(target);
      const { stat } = await import('node:fs/promises');
      const stats = await stat(target);
      expect(isDirModeAcceptable(stats.mode)).toBe(true);
    });

    it('refuses a pre-existing permissive data dir', async () => {
      if (!canTightenPerms) return;
      const target = path.join(workDir, 'data');
      await mkdir(target, { recursive: true });
      await chmod(target, 0o755);
      await expect(
        assertSecureStartup({
          dataDir: target,
          encryptionKey: decodeEncryptionKey(generateEncryptionKeyBase64()),
          insecureMode: false,
          nodeEnv: 'test',
        })
      ).rejects.toThrow(/permissive mode/);
    });
  });

  describe('resolveSecureStartupOptions', () => {
    it('defaults data dir to ~/.engram/data when env is missing', () => {
      const opts = resolveSecureStartupOptions({});
      expect(opts.dataDir).toMatch(/\.engram\/data$/);
      expect(opts.nodeEnv).toBe('development');
      expect(opts.encryptionKey).toBeDefined();
    });

    it('honours explicit insecure mode flag', () => {
      const opts = resolveSecureStartupOptions({
        LOCAL_INSECURE_MODE: 'true',
        NODE_ENV: 'development',
      });
      expect(opts.insecureMode).toBe(true);
      expect(opts.encryptionKey).toBeUndefined();
    });

    it('parses an explicit key when provided', () => {
      const rawKey = generateEncryptionKeyBase64();
      const opts = resolveSecureStartupOptions({
        LOCAL_ENCRYPTION_KEY: rawKey,
        NODE_ENV: 'production',
      });
      expect(opts.insecureMode).toBe(false);
      expect(opts.encryptionKey?.length).toBe(32);
    });
  });
});
