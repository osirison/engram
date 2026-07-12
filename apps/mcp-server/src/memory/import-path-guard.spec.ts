/**
 * Unit tests for the `import_agent_memory` path allowlist guard (A18).
 *
 * Uses REAL temp directories, files, and symlinks (no fs mocking) so the
 * realpath-based traversal / symlink-escape detection is exercised for real.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  assertImportPathAllowed,
  resolveAllowedImportRoot,
} from './import-path-guard';
import { ClientFacingError } from '../security/client-error.util';

describe('resolveAllowedImportRoot', () => {
  const prev = process.env.IMPORT_ALLOWED_ROOT;
  afterEach(() => {
    if (prev === undefined) delete process.env.IMPORT_ALLOWED_ROOT;
    else process.env.IMPORT_ALLOWED_ROOT = prev;
  });

  it('defaults to the server process home directory when the env var is unset', () => {
    delete process.env.IMPORT_ALLOWED_ROOT;
    expect(resolveAllowedImportRoot()).toBe(homedir());
  });

  it('treats a blank env value as unset', () => {
    process.env.IMPORT_ALLOWED_ROOT = '   ';
    expect(resolveAllowedImportRoot()).toBe(homedir());
  });

  it('returns IMPORT_ALLOWED_ROOT when set', () => {
    process.env.IMPORT_ALLOWED_ROOT = '/srv/engram/imports';
    expect(resolveAllowedImportRoot()).toBe('/srv/engram/imports');
  });
});

describe('assertImportPathAllowed', () => {
  let base: string;
  let root: string;
  let insideDir: string;
  let insideFile: string;
  let outsideFile: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'engram-import-guard-'));
    root = join(base, 'allowed-root');
    insideDir = join(root, 'vault');
    insideFile = join(insideDir, 'notes.md');
    outsideFile = join(base, 'secret.txt');
    await mkdir(insideDir, { recursive: true });
    await writeFile(insideFile, '# notes\n');
    await writeFile(outsideFile, 'outside the root\n');
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('accepts a path inside the root and returns its resolved real path', async () => {
    await expect(assertImportPathAllowed(insideFile, root)).resolves.toContain(
      'notes.md',
    );
  });

  it('accepts the root itself', async () => {
    await expect(assertImportPathAllowed(root, root)).resolves.toBeTruthy();
  });

  it('accepts a `..` path that still resolves inside the root', async () => {
    const zigzag = join(insideDir, '..', 'vault', 'notes.md');
    await expect(assertImportPathAllowed(zigzag, root)).resolves.toContain(
      'notes.md',
    );
  });

  it('rejects a `..` traversal escaping the root, naming the allowed root', async () => {
    const traversal = join(root, '..', basename(outsideFile));
    await expect(assertImportPathAllowed(traversal, root)).rejects.toThrow(
      ClientFacingError,
    );
    await expect(assertImportPathAllowed(traversal, root)).rejects.toThrow(
      /outside the allowed import root/,
    );
    await expect(assertImportPathAllowed(traversal, root)).rejects.toThrow(
      basename(root),
    );
  });

  it('rejects an out-of-root absolute path', async () => {
    await expect(assertImportPathAllowed(outsideFile, root)).rejects.toThrow(
      /outside the allowed import root/,
    );
  });

  it('rejects a symlink inside the root that points outside it', async () => {
    const link = join(insideDir, 'sneaky-link');
    await symlink(outsideFile, link);
    await expect(assertImportPathAllowed(link, root)).rejects.toThrow(
      /outside the allowed import root/,
    );
  });

  it('follows a symlink that points back inside the root', async () => {
    const link = join(root, 'friendly-link');
    await symlink(insideFile, link);
    await expect(assertImportPathAllowed(link, root)).resolves.toContain(
      'notes.md',
    );
  });

  it('does not treat a sibling directory sharing the root prefix as inside (no naive prefixing)', async () => {
    // root = .../allowed-root ; sibling = .../allowed-root2 — a string-prefix
    // check would wrongly admit the sibling.
    const sibling = `${root}2`;
    await mkdir(sibling, { recursive: true });
    const siblingFile = join(sibling, 'file.md');
    await writeFile(siblingFile, 'prefix trap\n');
    await expect(assertImportPathAllowed(siblingFile, root)).rejects.toThrow(
      /outside the allowed import root/,
    );
  });

  it('reports a clear error when the requested path does not exist', async () => {
    await expect(
      assertImportPathAllowed(join(root, 'no-such-file.md'), root),
    ).rejects.toThrow(/does not exist on the server/);
  });

  it('reports a clear error when the allowed root does not exist', async () => {
    await expect(
      assertImportPathAllowed(insideFile, join(base, 'missing-root')),
    ).rejects.toThrow(/Import root .* does not exist/);
  });

  it('uses the IMPORT_ALLOWED_ROOT env default when no explicit root is passed', async () => {
    const prev = process.env.IMPORT_ALLOWED_ROOT;
    process.env.IMPORT_ALLOWED_ROOT = root;
    try {
      await expect(assertImportPathAllowed(insideFile)).resolves.toContain(
        'notes.md',
      );
      await expect(assertImportPathAllowed(outsideFile)).rejects.toThrow(
        /outside the allowed import root/,
      );
    } finally {
      if (prev === undefined) delete process.env.IMPORT_ALLOWED_ROOT;
      else process.env.IMPORT_ALLOWED_ROOT = prev;
    }
  });
});
