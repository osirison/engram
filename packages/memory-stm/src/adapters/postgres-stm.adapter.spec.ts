import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresStmAdapter } from './postgres-stm.adapter';
import {
  StmMemoryNotFoundError,
  StmMemoryExpiredError,
  StmTtlValidationError,
  StmVersionConflictError,
} from '../types';

const USER_ID = 'clq1234567890abcdef1234'; // Valid CUID
const ORG_ID = 'tz4a98xxat96iws9zmbrgj3a'; // Valid CUID2
const MEM_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'; // UUID (STM id format)

type PrismaMock = {
  memory: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(): PrismaMock {
  return {
    memory: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date(Date.now() - 60_000);
  return {
    id: MEM_ID,
    userId: USER_ID,
    organizationId: null,
    scope: null,
    content: 'hello world',
    metadata: { accessCount: 0, ttl: 86400 },
    tags: ['greeting'],
    type: 'short-term',
    version: 1,
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(createdAt.getTime() + 86400_000),
    embedding: [],
    ...overrides,
  };
}

function makeAdapter(prisma: PrismaMock, embeddings?: { generate: ReturnType<typeof vi.fn> }) {
  return new PostgresStmAdapter(prisma as never, embeddings as never);
}

describe('PostgresStmAdapter', () => {
  let prisma: PrismaMock;
  let adapter: PostgresStmAdapter;

  beforeEach(() => {
    prisma = makePrisma();
    prisma.memory.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
    adapter = makeAdapter(prisma);
  });

  describe('create', () => {
    it('writes a short-term row with expiresAt and stamped metadata', async () => {
      const memory = await adapter.create({ userId: USER_ID, content: 'note to self' });

      expect(prisma.memory.create).toHaveBeenCalledOnce();
      const { data } = prisma.memory.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['type']).toBe('short-term');
      expect(data['userId']).toBe(USER_ID);
      expect(data['organizationId']).toBeNull();
      expect(data['version']).toBe(1);
      expect(data['expiresAt']).toBeInstanceOf(Date);
      expect(data['metadata']).toMatchObject({ accessCount: 0, ttl: 86400 });

      expect(memory.type).toBe('short-term');
      expect(memory.ttl).toBe(86400);
      expect(memory.accessCount).toBe(0);
      // STM ids are UUIDs (parity with the Redis-backed service).
      expect(memory.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('applies a custom TTL to expiresAt', async () => {
      const before = Date.now();
      const memory = await adapter.create({ userId: USER_ID, content: 'brief', ttl: 3600 });

      expect(memory.ttl).toBe(3600);
      const delta = memory.expiresAt.getTime() - before;
      expect(delta).toBeGreaterThanOrEqual(3600_000 - 1000);
      expect(delta).toBeLessThanOrEqual(3600_000 + 1000);
    });

    it('rejects a TTL outside the allowed bounds', async () => {
      await expect(
        adapter.create({ userId: USER_ID, content: 'too long', ttl: 999_999_999 })
      ).rejects.toThrow(/TTL/);
    });

    it('preserves user metadata alongside the stamped keys', async () => {
      await adapter.create({
        userId: USER_ID,
        content: 'with meta',
        metadata: { source: 'test' },
      });

      const { data } = prisma.memory.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['metadata']).toMatchObject({ source: 'test', accessCount: 0 });
    });

    it('stores the embedding when the embeddings service succeeds', async () => {
      const embeddings = { generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2] }) };
      adapter = makeAdapter(prisma, embeddings);

      const memory = await adapter.create({ userId: USER_ID, content: 'embed me' });

      expect(memory.embedding).toEqual([0.1, 0.2]);
    });

    it('creates the memory without an embedding when generation fails', async () => {
      const embeddings = { generate: vi.fn().mockRejectedValue(new Error('ollama down')) };
      adapter = makeAdapter(prisma, embeddings);

      const memory = await adapter.create({ userId: USER_ID, content: 'still works' });

      expect(memory.embedding).toEqual([]);
    });

    it('persists scope and organizationId', async () => {
      await adapter.create({
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: 'agent:claude',
        content: 'org scoped',
      });

      const { data } = prisma.memory.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['organizationId']).toBe(ORG_ID);
      expect(data['scope']).toBe('agent:claude');
    });
  });

  describe('findById', () => {
    it('returns the memory and bumps accessCount', async () => {
      prisma.memory.findFirst.mockResolvedValue(makeRow());

      const memory = await adapter.findById(USER_ID, MEM_ID);

      expect(memory.accessCount).toBe(1);
      expect(prisma.memory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { metadata: expect.objectContaining({ accessCount: 1 }) },
        })
      );
    });

    it('scopes the lookup to personal rows when no organizationId is given', async () => {
      prisma.memory.findFirst.mockResolvedValue(null);

      await expect(adapter.findById(USER_ID, MEM_ID)).rejects.toThrow(StmMemoryNotFoundError);

      const { where } = prisma.memory.findFirst.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['organizationId']).toBeNull();
      expect(where['type']).toBe('short-term');
    });

    it('deletes and reports an expired memory', async () => {
      prisma.memory.findFirst.mockResolvedValue(
        makeRow({ expiresAt: new Date(Date.now() - 1000) })
      );

      await expect(adapter.findById(USER_ID, MEM_ID)).rejects.toThrow(StmMemoryExpiredError);
      expect(prisma.memory.deleteMany).toHaveBeenCalledWith({ where: { id: MEM_ID } });
    });

    it('treats a scope mismatch as not-found', async () => {
      prisma.memory.findFirst.mockResolvedValue(makeRow({ scope: 'agent:a' }));

      await expect(adapter.findById(USER_ID, MEM_ID, undefined, 'agent:b')).rejects.toThrow(
        StmMemoryNotFoundError
      );
    });

    it('still returns the memory when the accessCount persist fails', async () => {
      prisma.memory.findFirst.mockResolvedValue(makeRow());
      prisma.memory.updateMany.mockRejectedValue(new Error('db hiccup'));

      const memory = await adapter.findById(USER_ID, MEM_ID);

      expect(memory.accessCount).toBe(1);
    });
  });

  describe('update', () => {
    it('preserves expiresAt when no ttl is provided', async () => {
      const row = makeRow();
      prisma.memory.findFirst
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, content: 'updated', version: 2 });

      await adapter.update(USER_ID, MEM_ID, { content: 'updated', tags: row.tags });

      const { data } = prisma.memory.updateMany.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['expiresAt']).toEqual(row.expiresAt);
    });

    it('resets expiresAt when a new ttl is provided', async () => {
      const row = makeRow();
      prisma.memory.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row });
      const before = Date.now();

      await adapter.update(USER_ID, MEM_ID, { ttl: 7200, tags: row.tags });

      const { data } = prisma.memory.updateMany.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      const expires = (data['expiresAt'] as Date).getTime();
      expect(expires).toBeGreaterThanOrEqual(before + 7200_000 - 1000);
      expect(expires).toBeLessThanOrEqual(before + 7200_000 + 1000);
      expect(data['metadata']).toMatchObject({ ttl: 7200 });
    });

    it('performs a version-guarded CAS when expectedVersion is set', async () => {
      const row = makeRow({ version: 3 });
      prisma.memory.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce({
        ...row,
        version: 4,
      });

      await adapter.update(USER_ID, MEM_ID, {
        content: 'cas write',
        tags: row.tags,
        expectedVersion: 3,
      });

      const { where, data } = prisma.memory.updateMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(where['version']).toBe(3);
      expect(data['version']).toBe(4);
    });

    it('throws StmVersionConflictError when expectedVersion mismatches the read', async () => {
      prisma.memory.findFirst.mockResolvedValue(makeRow({ version: 5 }));

      await expect(
        adapter.update(USER_ID, MEM_ID, { content: 'stale', tags: [], expectedVersion: 2 })
      ).rejects.toThrow(StmVersionConflictError);
    });

    it('throws StmVersionConflictError when a concurrent writer wins the CAS', async () => {
      const row = makeRow({ version: 1 });
      prisma.memory.findFirst
        .mockResolvedValueOnce(row)
        // Re-read after the failed CAS reveals the concurrent bump.
        .mockResolvedValueOnce({ ...row, version: 2 });
      prisma.memory.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        adapter.update(USER_ID, MEM_ID, { content: 'raced', tags: [], expectedVersion: 1 })
      ).rejects.toThrow(StmVersionConflictError);
    });

    it('bumps version atomically on the legacy last-write-wins path', async () => {
      const row = makeRow();
      prisma.memory.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row });

      await adapter.update(USER_ID, MEM_ID, { content: 'lww', tags: row.tags });

      const { data } = prisma.memory.updateMany.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['version']).toEqual({ increment: 1 });
    });

    it('replaces metadata but re-stamps the adapter-managed keys', async () => {
      const row = makeRow({ metadata: { accessCount: 7, ttl: 86400, old: true } });
      prisma.memory.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row });

      await adapter.update(USER_ID, MEM_ID, { metadata: { fresh: true }, tags: row.tags });

      const { data } = prisma.memory.updateMany.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['metadata']).toEqual({ fresh: true, accessCount: 7, ttl: 86400 });
    });
  });

  describe('delete', () => {
    it('deletes an existing memory', async () => {
      await adapter.delete(USER_ID, MEM_ID);

      const { where } = prisma.memory.deleteMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['id']).toBe(MEM_ID);
      expect(where['userId']).toBe(USER_ID);
      expect(where['type']).toBe('short-term');
    });

    it('throws when nothing was deleted', async () => {
      prisma.memory.deleteMany.mockResolvedValue({ count: 0 });

      await expect(adapter.delete(USER_ID, MEM_ID)).rejects.toThrow(StmMemoryNotFoundError);
    });

    it('treats a scope mismatch as not-found without deleting', async () => {
      prisma.memory.findFirst.mockResolvedValue(makeRow({ scope: 'agent:a' }));

      await expect(adapter.delete(USER_ID, MEM_ID, undefined, 'agent:b')).rejects.toThrow(
        StmMemoryNotFoundError
      );
      expect(prisma.memory.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('filters to live personal short-term rows and paginates', async () => {
      const rows = [
        makeRow({ id: MEM_ID }),
        makeRow({ id: '1f8fad5b-d9cb-469f-a165-708677289511' }),
      ];
      prisma.memory.findMany.mockResolvedValue(rows);
      prisma.memory.count.mockResolvedValue(2);

      const result = await adapter.list(USER_ID, { limit: 5 });

      const { where, take } = prisma.memory.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
        take: number;
      };
      expect(where['type']).toBe('short-term');
      expect(where['organizationId']).toBeNull();
      expect(where['expiresAt']).toEqual({ gt: expect.any(Date) });
      expect(take).toBe(6); // limit + 1 look-ahead
      expect(result.items).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(result.hasNextPage).toBe(false);
      expect(result.endCursor).toBe('0');
    });

    it('signals a next page and exposes the cursor', async () => {
      const rows = [
        makeRow({ id: '0f8fad5b-d9cb-469f-a165-708677289501' }),
        makeRow({ id: '0f8fad5b-d9cb-469f-a165-708677289502' }),
        makeRow({ id: '0f8fad5b-d9cb-469f-a165-708677289503' }),
      ];
      prisma.memory.findMany.mockResolvedValue(rows);
      prisma.memory.count.mockResolvedValue(3);

      const result = await adapter.list(USER_ID, { limit: 2 });

      expect(result.hasNextPage).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.endCursor).toBe('0f8fad5b-d9cb-469f-a165-708677289502');
    });

    it('resumes from a cursor', async () => {
      prisma.memory.findMany.mockResolvedValue([]);

      await adapter.list(USER_ID, { limit: 2, cursor: MEM_ID });

      const call = prisma.memory.findMany.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['cursor']).toEqual({ id: MEM_ID });
      expect(call['skip']).toBe(1);
    });

    it('applies match-any tag filtering and scope filtering', async () => {
      prisma.memory.findMany.mockResolvedValue([]);

      await adapter.list(USER_ID, { tags: ['a', 'b'], scope: 'session:1' });

      const { where } = prisma.memory.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['tags']).toEqual({ hasSome: ['a', 'b'] });
      expect(where['scope']).toBe('session:1');
    });
  });

  describe('getTtl / extendTtl', () => {
    it('returns the remaining TTL in seconds', async () => {
      prisma.memory.findFirst.mockResolvedValue(
        makeRow({ expiresAt: new Date(Date.now() + 120_000) })
      );

      const ttl = await adapter.getTtl(USER_ID, MEM_ID);

      expect(ttl).toBeGreaterThanOrEqual(119);
      expect(ttl).toBeLessThanOrEqual(121);
    });

    it('reports an expired memory as not-found (Redis TTL=-2 parity)', async () => {
      prisma.memory.findFirst.mockResolvedValue(
        makeRow({ expiresAt: new Date(Date.now() - 1000) })
      );

      await expect(adapter.getTtl(USER_ID, MEM_ID)).rejects.toThrow(StmMemoryNotFoundError);
    });

    it('extends the TTL from the remaining window', async () => {
      const row = makeRow({ expiresAt: new Date(Date.now() + 600_000) }); // 10 min left
      prisma.memory.findFirst.mockResolvedValue(row);
      prisma.memory.updateMany.mockResolvedValue({ count: 1 });

      await adapter.extendTtl(USER_ID, MEM_ID, 600);

      const updateCall = prisma.memory.updateMany.mock.calls.at(-1)![0] as {
        data: Record<string, unknown>;
      };
      const ttl = (updateCall.data['metadata'] as Record<string, unknown>)['ttl'] as number;
      expect(ttl).toBeGreaterThanOrEqual(1199);
      expect(ttl).toBeLessThanOrEqual(1201);
    });

    it('rejects an extension that exceeds the max TTL', async () => {
      prisma.memory.findFirst.mockResolvedValue(
        makeRow({ expiresAt: new Date(Date.now() + 604_000_000) })
      );

      await expect(adapter.extendTtl(USER_ID, MEM_ID, 604_800)).rejects.toThrow(
        StmTtlValidationError
      );
    });
  });

  describe('count / clear', () => {
    it('counts live personal rows with filters', async () => {
      prisma.memory.count.mockResolvedValue(4);

      const count = await adapter.count(USER_ID, { tags: ['x'] });

      expect(count).toBe(4);
      const { where } = prisma.memory.count.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['tags']).toEqual({ hasSome: ['x'] });
      expect(where['expiresAt']).toEqual({ gt: expect.any(Date) });
    });

    it('clears all personal short-term rows for a user', async () => {
      prisma.memory.deleteMany.mockResolvedValue({ count: 3 });

      const deleted = await adapter.clear(USER_ID);

      expect(deleted).toBe(3);
      const { where } = prisma.memory.deleteMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where).toEqual({
        userId: USER_ID,
        organizationId: null,
        type: 'short-term',
      });
    });
  });

  describe('findCandidates', () => {
    it('rejects a non-positive threshold', async () => {
      await expect(adapter.findCandidates(0)).rejects.toThrow(/threshold/);
    });

    it('filters on the accessCount metadata path', async () => {
      prisma.memory.findMany.mockResolvedValue([
        makeRow({ metadata: { accessCount: 5, ttl: 86400 } }),
      ]);

      const candidates = await adapter.findCandidates(3);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.accessCount).toBe(5);
      const { where } = prisma.memory.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['metadata']).toEqual({ path: ['accessCount'], gte: 3 });
      // Global scan: no userId restriction.
      expect(where['userId']).toBeUndefined();
    });

    it('restricts to personal rows when a userId is given', async () => {
      prisma.memory.findMany.mockResolvedValue([]);

      await adapter.findCandidates(3, USER_ID);

      const { where } = prisma.memory.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['userId']).toBe(USER_ID);
      expect(where['organizationId']).toBeNull();
    });
  });

  describe('sweepExpired', () => {
    it('bulk-deletes expired short-term rows', async () => {
      prisma.memory.deleteMany.mockResolvedValue({ count: 12 });

      const swept = await adapter.sweepExpired();

      expect(swept).toBe(12);
      const { where } = prisma.memory.deleteMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['type']).toBe('short-term');
      expect(where['expiresAt']).toEqual({ lte: expect.any(Date) });
    });
  });
});
