import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStmService } from './memory-stm.service';
import { StmMemoryNotFoundError } from './types';

const SCOPE_A = 'agent:agent-alpha';
const SCOPE_B = 'session:session-beta';
const USER_A = 'cldx4k8xp000108l83h4y8v2q';
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

describe('MemoryStmService — scope isolation', () => {
  let redis: ReturnType<typeof makeRedis>;
  let service: MemoryStmService;

  beforeEach(() => {
    redis = makeRedis();
    service = new MemoryStmService(redis as never);
  });

  describe('create — scope persisted in payload', () => {
    it('stores scope in the Redis JSON payload', async () => {
      const mem = await service.create({
        userId: USER_A,
        scope: SCOPE_A,
        content: 'scoped fact',
        ttl: TTL,
      });

      // Find the stored key and parse the value
      const allKeys = [...redis.store.keys()];
      expect(allKeys).toHaveLength(1);
      const raw = redis.store.get(allKeys[0]!)?.value;
      const parsed = JSON.parse(raw!);
      expect(parsed.scope).toBe(SCOPE_A);
      expect(mem.scope).toBe(SCOPE_A);
    });

    it('scope is undefined when not provided', async () => {
      const mem = await service.create({
        userId: USER_A,
        content: 'unscoped fact',
        ttl: TTL,
      });
      expect(mem.scope).toBeUndefined();
    });
  });

  describe('findById — scope verification', () => {
    it('returns memory when scope matches', async () => {
      const created = await service.create({
        userId: USER_A,
        scope: SCOPE_A,
        content: 'scoped fact',
        ttl: TTL,
      });

      const found = await service.findById(USER_A, created.id, undefined, SCOPE_A);
      expect(found.scope).toBe(SCOPE_A);
    });

    it('throws StmMemoryNotFoundError when scope does not match', async () => {
      const created = await service.create({
        userId: USER_A,
        scope: SCOPE_A,
        content: 'scoped fact',
        ttl: TTL,
      });

      await expect(service.findById(USER_A, created.id, undefined, SCOPE_B)).rejects.toThrow(
        StmMemoryNotFoundError
      );
    });

    it('returns memory without scope check when scope not provided', async () => {
      const created = await service.create({
        userId: USER_A,
        scope: SCOPE_A,
        content: 'scoped fact',
        ttl: TTL,
      });

      const found = await service.findById(USER_A, created.id);
      expect(found.scope).toBe(SCOPE_A);
    });
  });

  describe('delete — scope verification', () => {
    it('deletes the memory when the scope matches', async () => {
      const created = await service.create({
        userId: USER_A,
        scope: SCOPE_A,
        content: 'scoped fact',
        ttl: TTL,
      });

      await service.delete(USER_A, created.id, undefined, SCOPE_A);

      await expect(service.findById(USER_A, created.id)).rejects.toThrow(StmMemoryNotFoundError);
    });

    it('does NOT delete and throws when the scope does not match', async () => {
      const created = await service.create({
        userId: USER_A,
        scope: SCOPE_A,
        content: 'scoped fact',
        ttl: TTL,
      });

      await expect(service.delete(USER_A, created.id, undefined, SCOPE_B)).rejects.toThrow(
        StmMemoryNotFoundError
      );

      // The memory must still be present — a foreign scope cannot delete it.
      const stillThere = await service.findById(USER_A, created.id);
      expect(stillThere.scope).toBe(SCOPE_A);
    });

    it('deletes without a scope check when scope is not provided', async () => {
      const created = await service.create({
        userId: USER_A,
        scope: SCOPE_A,
        content: 'scoped fact',
        ttl: TTL,
      });

      await service.delete(USER_A, created.id);

      await expect(service.findById(USER_A, created.id)).rejects.toThrow(StmMemoryNotFoundError);
    });
  });

  describe('list — scope filter', () => {
    beforeEach(async () => {
      await Promise.all([
        service.create({ userId: USER_A, scope: SCOPE_A, content: 'agent A mem', ttl: TTL }),
        service.create({ userId: USER_A, scope: SCOPE_B, content: 'session B mem', ttl: TTL }),
        service.create({ userId: USER_A, content: 'unscoped mem', ttl: TTL }),
      ]);
    });

    it('returns only scope A memories when scope=SCOPE_A', async () => {
      const result = await service.list(USER_A, { scope: SCOPE_A });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.scope).toBe(SCOPE_A);
    });

    it('returns only scope B memories when scope=SCOPE_B', async () => {
      const result = await service.list(USER_A, { scope: SCOPE_B });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.scope).toBe(SCOPE_B);
    });

    it('returns all memories when no scope filter provided', async () => {
      const result = await service.list(USER_A);
      expect(result.items).toHaveLength(3);
    });
  });

  describe('count — scope filter', () => {
    beforeEach(async () => {
      await Promise.all([
        service.create({ userId: USER_A, scope: SCOPE_A, content: 'agent A 1', ttl: TTL }),
        service.create({ userId: USER_A, scope: SCOPE_A, content: 'agent A 2', ttl: TTL }),
        service.create({ userId: USER_A, scope: SCOPE_B, content: 'session B 1', ttl: TTL }),
      ]);
    });

    it('counts only memories in scope A', async () => {
      const count = await service.count(USER_A, { scope: SCOPE_A });
      expect(count).toBe(2);
    });

    it('counts only memories in scope B', async () => {
      const count = await service.count(USER_A, { scope: SCOPE_B });
      expect(count).toBe(1);
    });

    it('counts all when no scope filter', async () => {
      const count = await service.count(USER_A);
      expect(count).toBe(3);
    });
  });

  describe('scope A and scope B memories in separate logical namespaces', () => {
    it('list scope A cannot see scope B memories', async () => {
      await service.create({ userId: USER_A, scope: SCOPE_A, content: 'secret A', ttl: TTL });
      await service.create({ userId: USER_A, scope: SCOPE_B, content: 'secret B', ttl: TTL });

      const resultA = await service.list(USER_A, { scope: SCOPE_A });
      const resultB = await service.list(USER_A, { scope: SCOPE_B });

      expect(resultA.items.map((m) => m.content)).not.toContain('secret B');
      expect(resultB.items.map((m) => m.content)).not.toContain('secret A');
    });
  });
});
