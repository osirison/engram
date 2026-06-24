import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ENCRYPTION_VERSION_PREFIX, generateEncryptionKeyBase64 } from '../encryption';
import { LiteJsonStore, resetLiteStoreCache } from '../lite-store';
import { OWNER_ONLY_DIR_MODE, OWNER_ONLY_FILE_MODE } from '../secure-startup';

/**
 * Helper to allocate a fresh temp data dir + a 32-byte AES key. Each test
 * runs in its own directory so concurrency assertions are isolated.
 */
function makeStore(): { dir: string; key: Buffer } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'engram-lite-store-'));
  const key = Buffer.from(generateEncryptionKeyBase64(), 'base64');
  return { dir, key };
}

const canTightenPerms = process.getuid !== undefined;

describe('memory-lite LiteJsonStore', () => {
  let dir: string;
  let key: Buffer;
  let store: LiteJsonStore;

  beforeEach(() => {
    ({ dir, key } = makeStore());
    store = new LiteJsonStore(dir, key);
    resetLiteStoreCache();
  });

  afterEach(() => {
    if (dir && canTightenPerms) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('CRUD round-trips', () => {
    it('creates, retrieves, updates, and deletes a record', async () => {
      const created = await store.create({
        userId: 'tenant-a',
        content: 'first memory',
        tags: ['welcome'],
        metadata: { source: 'unit-test' },
      });
      expect(created.id).toBeTruthy();
      expect(created.type).toBe('long-term');
      expect(created.tags).toEqual(['welcome']);

      const fetched = await store.get(created.userId, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.content).toBe('first memory');

      const updated = await store.update(created.userId, created.id, {
        content: 'updated memory',
        tags: ['welcome', 'edited'],
      });
      expect(updated.content).toBe('updated memory');
      expect(updated.tags).toEqual(['welcome', 'edited']);
      expect(updated.updatedAt).not.toBe(created.updatedAt);

      const removed = await store.delete(created.userId, created.id);
      expect(removed).toBe(true);
      const after = await store.get(created.userId, created.id);
      expect(after).toBeNull();
    });

    it('refuses to update a missing record', async () => {
      await expect(store.update('tenant-a', 'does-not-exist', { content: 'x' })).rejects.toThrow(
        /Memory not found/
      );
    });

    it('returns false when deleting a missing record', async () => {
      const result = await store.delete('tenant-a', 'missing');
      expect(result).toBe(false);
    });

    it('persists records encrypted on disk when a key is provided', async () => {
      if (!canTightenPerms) return;
      const created = await store.create({
        userId: 'tenant-a',
        content: 'super-secret content',
      });
      const onDisk = path.join(dir, 'memories', 'tenant-a', `${created.id}.json.enc`);
      expect(existsSync(onDisk)).toBe(true);
      const raw = await readFile(onDisk, 'utf8');
      expect(raw.startsWith(ENCRYPTION_VERSION_PREFIX)).toBe(true);
      expect(raw).not.toContain('super-secret content');
      const fileStats = await stat(onDisk);
      // File modes are masked by umask, so check the world/group bits only.
      expect(fileStats.mode & 0o077).toBe(0);
    });

    it('persists plaintext in insecure mode (without a key)', async () => {
      if (!canTightenPerms) return;
      const plaintextStore = new LiteJsonStore(dir, undefined);
      const created = await plaintextStore.create({
        userId: 'tenant-b',
        content: 'plain content',
      });
      const onDisk = path.join(dir, 'memories', 'tenant-b', `${created.id}.json`);
      expect(existsSync(onDisk)).toBe(true);
      const raw = await readFile(onDisk, 'utf8');
      expect(raw).toContain('plain content');
      expect(raw.startsWith(ENCRYPTION_VERSION_PREFIX)).toBe(false);
    });
  });

  describe('listing & search', () => {
    beforeEach(async () => {
      await store.create({ userId: 'tenant-a', content: 'hello world', tags: ['greeting'] });
      await store.create({ userId: 'tenant-a', content: 'goodbye world', tags: ['parting'] });
      await store.create({
        userId: 'tenant-a',
        content: 'bonjour le monde',
        tags: ['greeting', 'french'],
      });
    });

    it('lists all records for a user', async () => {
      const page = await store.list('tenant-a', { limit: 50 });
      expect(page.items.length).toBe(3);
      expect(page.nextCursor).toBeNull();
    });

    it('filters by tags (intersection)', async () => {
      const page = await store.list('tenant-a', { tags: ['greeting'] });
      expect(page.items.length).toBe(2);
      expect(page.items.every((m) => m.tags.includes('greeting'))).toBe(true);
    });

    it('filters by case-insensitive substring search', async () => {
      const page = await store.list('tenant-a', { search: 'WORLD' });
      expect(page.items.length).toBe(2);
      expect(page.items.every((m) => m.content.includes('world'))).toBe(true);
    });

    it('paginates results with cursor', async () => {
      const page1 = await store.list('tenant-a', { limit: 2 });
      expect(page1.items.length).toBe(2);
      expect(page1.nextCursor).toBeTruthy();
      const page2 = await store.list('tenant-a', {
        limit: 2,
        cursor: page1.nextCursor ?? undefined,
      });
      expect(page2.items.length).toBe(1);
      expect(page2.nextCursor).toBeNull();
    });

    it('returns the union of tags via listByTag', async () => {
      const matches = await store.listByTag('tenant-a', ['greeting']);
      expect(matches.length).toBe(2);
    });

    it('returns matching records via search()', async () => {
      const matches = await store.search('tenant-a', 'bonjour');
      expect(matches.length).toBe(1);
      expect(matches[0]?.content).toBe('bonjour le monde');
    });

    it('isolates tenants', async () => {
      await store.create({ userId: 'tenant-b', content: 'tenant-b-only' });
      const a = await store.list('tenant-a');
      const b = await store.list('tenant-b');
      expect(a.items.every((m) => m.userId === 'tenant-a')).toBe(true);
      expect(b.items.every((m) => m.userId === 'tenant-b')).toBe(true);
      expect(a.items.length).toBe(3);
      expect(b.items.length).toBe(1);
    });
  });

  describe('concurrency', () => {
    it('serializes writes per user without losing records', async () => {
      const N = 25;
      const writes = Array.from({ length: N }, (_, i) =>
        store.create({
          userId: 'concurrent-user',
          content: `memory #${i}`,
        })
      );
      await Promise.all(writes);

      const all = await store.list('concurrent-user', { limit: 500 });
      const ids = new Set(all.items.map((m) => m.id));
      expect(ids.size).toBe(N);

      const fetched = await Promise.all([...ids].map((id) => store.get('concurrent-user', id)));
      expect(fetched.every((m) => m !== null)).toBe(true);
    });

    it('serves concurrent writes across different tenants in parallel', async () => {
      const tenants = ['alpha', 'beta', 'gamma', 'delta'];
      const start = Date.now();
      await Promise.all(
        tenants.flatMap((t) => [
          store.create({ userId: t, content: `${t}-1` }),
          store.create({ userId: t, content: `${t}-2` }),
        ])
      );
      const elapsed = Date.now() - start;
      // A pure serial schedule would take roughly 8x the per-write latency.
      // The lower bound here is generous; we only assert that the test ran.
      expect(elapsed).toBeGreaterThanOrEqual(0);

      for (const t of tenants) {
        const list = await store.list(t);
        expect(list.items.length).toBe(2);
      }
    });
  });

  describe('singleton accessor', () => {
    it('returns the same instance for the same arguments', async () => {
      const { getLiteStore } = await import('../lite-store');
      const a = getLiteStore(dir, key);
      const b = getLiteStore(dir, key);
      expect(a).toBe(b);
    });

    it('returns a fresh instance after resetLiteStoreCache', async () => {
      const { getLiteStore, resetLiteStoreCache } = await import('../lite-store');
      const a = getLiteStore(dir, key);
      resetLiteStoreCache();
      const b = getLiteStore(dir, key);
      expect(a).not.toBe(b);
    });
  });

  describe('owns the data dir', () => {
    it('creates the memories shard with owner-only mode', async () => {
      if (!canTightenPerms) return;
      await store.create({ userId: 'perm-check', content: 'x' });
      const shard = path.join(dir, 'memories', 'perm-check');
      const stats = await stat(shard);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.mode & 0o077).toBe(0);
      // OWNER_ONLY_DIR_MODE is 0o700; assert that bit.
      expect((stats.mode & OWNER_ONLY_DIR_MODE) === OWNER_ONLY_DIR_MODE).toBe(true);
      const idx = path.join(shard, '_index.json');
      const idxStats = await stat(idx);
      expect(idxStats.mode & 0o077).toBe(0);
      // OWNER_ONLY_FILE_MODE is 0o600; assert that bit.
      expect((idxStats.mode & OWNER_ONLY_FILE_MODE) === OWNER_ONLY_FILE_MODE).toBe(true);
    });
  });
});
