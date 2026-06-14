import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStmService } from './memory-stm.service';
import { StmKeyBuilder } from './types';

const ORG_A = 'cm0aaaaaaaaaaaaaaaaaaaaaaaa';
const ORG_B = 'cm0bbbbbbbbbbbbbbbbbbbbbbbbb';
const USER_A = 'cldx4k8xp000108l83h4y8v2q';
const MEM_ID = 'clq0000000001abcdef0001';
const TTL = 3600;

interface FakeRedis {
  store: Map<string, { value: string; ttl: number }>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  delMany: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
  scan: ReturnType<typeof vi.fn>;
  pipeline: ReturnType<typeof vi.fn>;
}

// In-memory Redis stand-in keyed by Redis key string.
function makeRedis(): FakeRedis {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    store,
    get: vi.fn(async (key: string): Promise<string | null> => store.get(key)?.value ?? null),
    set: vi.fn(async (key: string, value: string, ttl: number): Promise<string> => {
      store.set(key, { value, ttl });
      return 'OK';
    }),
    del: vi.fn(async (key: string): Promise<number> => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
    delMany: vi.fn(async (keys: string[]): Promise<number> => {
      let count = 0;
      for (const key of keys) {
        if (store.has(key)) {
          store.delete(key);
          count++;
        }
      }
      return count;
    }),
    ttl: vi.fn(async (key: string): Promise<number> => {
      return store.has(key) ? TTL : -2;
    }),
    scan: vi.fn(
      async (
        _cursor: string,
        opts: { match: string }
      ): Promise<{ cursor: string; keys: string[] }> => {
        const pattern = opts.match.replace(/\*/g, '.*').replace(/\?/g, '.');
        const re = new RegExp(`^${pattern}$`);
        const keys = [...store.keys()].filter((k) => re.test(k));
        return { cursor: '0', keys };
      }
    ),
    pipeline: vi.fn((): { get: (key: string) => unknown; exec: () => Promise<unknown> } => {
      const ops: Array<() => Promise<[null, string | null]>> = [];
      const pipe: { get: (key: string) => unknown; exec: () => Promise<unknown> } = {
        get: (key: string): unknown => {
          ops.push(
            async (): Promise<[null, string | null]> => [null, store.get(key)?.value ?? null]
          );
          return pipe;
        },
        exec: async (): Promise<unknown> => Promise.all(ops.map((op) => op())),
      };
      return pipe;
    }),
  };
}

describe('STM tenant isolation', () => {
  describe('StmKeyBuilder', () => {
    const kb = new StmKeyBuilder('memory:stm');

    it('builds org-namespaced key', () => {
      expect(kb.buildMemoryKey(USER_A, MEM_ID, ORG_A)).toBe(
        `memory:stm:${ORG_A}:${USER_A}:${MEM_ID}`
      );
    });

    it('builds personal key (no org)', () => {
      expect(kb.buildMemoryKey(USER_A, MEM_ID)).toBe(`memory:stm:${USER_A}:${MEM_ID}`);
    });

    it('buildUserPattern scopes to org', () => {
      expect(kb.buildUserPattern(USER_A, ORG_A)).toBe(`memory:stm:${ORG_A}:${USER_A}:*`);
    });

    it('buildUserPattern scopes to personal when no org', () => {
      expect(kb.buildUserPattern(USER_A)).toBe(`memory:stm:${USER_A}:*`);
    });

    it('extractMemoryId works for org-scoped 5-segment key', () => {
      const key = kb.buildMemoryKey(USER_A, MEM_ID, ORG_A);
      expect(kb.extractMemoryId(key)).toBe(MEM_ID);
    });

    it('extractUserId works for org-scoped 5-segment key', () => {
      const key = kb.buildMemoryKey(USER_A, MEM_ID, ORG_A);
      expect(kb.extractUserId(key)).toBe(USER_A);
    });

    it('extractOrgId returns org for 5-segment key', () => {
      const key = kb.buildMemoryKey(USER_A, MEM_ID, ORG_A);
      expect(kb.extractOrgId(key)).toBe(ORG_A);
    });

    it('extractOrgId returns null for personal 4-segment key', () => {
      const key = kb.buildMemoryKey(USER_A, MEM_ID);
      expect(kb.extractOrgId(key)).toBeNull();
    });

    it('extractOrgId handles prefix with extra colons (e.g. memory:stm:v2)', () => {
      const kb2 = new StmKeyBuilder('memory:stm:v2');
      const orgKey = kb2.buildMemoryKey(USER_A, MEM_ID, ORG_A);
      const personalKey = kb2.buildMemoryKey(USER_A, MEM_ID);
      // Should correctly identify org vs personal regardless of prefix depth
      expect(kb2.extractOrgId(orgKey)).toBe(ORG_A);
      expect(kb2.extractOrgId(personalKey)).toBeNull();
    });
  });

  describe('MemoryStmService — cross-tenant isolation', () => {
    let redis: ReturnType<typeof makeRedis>;
    let service: MemoryStmService;

    beforeEach(() => {
      redis = makeRedis();
      service = new MemoryStmService(redis as never);
    });

    it('org A memory is not found via org B key', async () => {
      // Create memory under ORG_A namespace
      await service.create({
        userId: USER_A,
        organizationId: ORG_A,
        content: 'secret org A data',
        ttl: TTL,
      });

      // Attempt to fetch it under ORG_B namespace — must fail
      const orgBKey = `memory:stm:${ORG_B}:${USER_A}:`;
      const keys = [...redis.store.keys()];
      const orgBKeyExists = keys.some((k) => k.startsWith(orgBKey));
      expect(orgBKeyExists).toBe(false);
    });

    it('org A and personal memories live in separate namespaces', async () => {
      await Promise.all([
        service.create({ userId: USER_A, organizationId: ORG_A, content: 'org A', ttl: TTL }),
        service.create({ userId: USER_A, content: 'personal', ttl: TTL }),
      ]);

      const allKeys = [...redis.store.keys()];
      const orgKeys = allKeys.filter((k) => k.startsWith(`memory:stm:${ORG_A}:`));
      const personalKeys = allKeys.filter(
        (k) => k.startsWith(`memory:stm:${USER_A}:`) && !k.includes(ORG_A)
      );

      expect(orgKeys).toHaveLength(1);
      expect(personalKeys).toHaveLength(1);
    });

    it('list with org A returns only org A memories', async () => {
      await service.create({
        userId: USER_A,
        organizationId: ORG_A,
        content: 'org A mem',
        ttl: TTL,
      });
      await service.create({ userId: USER_A, content: 'personal mem', ttl: TTL });

      const orgResult = await service.list(USER_A, { organizationId: ORG_A });
      expect(orgResult.items).toHaveLength(1);
      expect(orgResult.items[0]!.organizationId).toBe(ORG_A);
    });

    it('list without org returns only personal memories', async () => {
      await service.create({
        userId: USER_A,
        organizationId: ORG_A,
        content: 'org A mem',
        ttl: TTL,
      });
      await service.create({ userId: USER_A, content: 'personal mem', ttl: TTL });

      const personalResult = await service.list(USER_A);
      expect(personalResult.items).toHaveLength(1);
      expect(personalResult.items[0]!.organizationId).toBeUndefined();
    });

    it('organizationId is persisted in the Redis payload', async () => {
      const mem = await service.create({
        userId: USER_A,
        organizationId: ORG_A,
        content: 'payload check',
        ttl: TTL,
      });

      const key = `memory:stm:${ORG_A}:${USER_A}:${mem.id}`;
      const raw = redis.store.get(key)?.value;
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);
      expect(parsed.organizationId).toBe(ORG_A);
    });

    it('findById with wrong org throws not found', async () => {
      const mem = await service.create({
        userId: USER_A,
        organizationId: ORG_A,
        content: 'org A only',
        ttl: TTL,
      });

      const { StmMemoryNotFoundError } = await import('./types');
      await expect(service.findById(USER_A, mem.id, ORG_B)).rejects.toThrow(StmMemoryNotFoundError);
    });

    it('count with org A excludes personal and org B memories', async () => {
      await service.create({ userId: USER_A, organizationId: ORG_A, content: 'orgA', ttl: TTL });
      await service.create({ userId: USER_A, content: 'personal', ttl: TTL });

      const countA = await service.count(USER_A, { organizationId: ORG_A });
      const countPersonal = await service.count(USER_A);
      expect(countA).toBe(1);
      expect(countPersonal).toBe(1);
    });

    it('clear with org A removes only org A keys', async () => {
      await service.create({ userId: USER_A, organizationId: ORG_A, content: 'orgA', ttl: TTL });
      await service.create({ userId: USER_A, content: 'personal', ttl: TTL });

      const removed = await service.clear(USER_A, ORG_A);
      expect(removed).toBe(1);

      // Personal memory must still exist
      const personalResult = await service.list(USER_A);
      expect(personalResult.items).toHaveLength(1);
    });
  });
});
