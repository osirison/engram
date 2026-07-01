import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantService } from './qdrant.service';
import { QdrantVectorStore, toQdrantPointId } from './qdrant.vector-store';
import { PgVectorStore, type PgVectorClient } from './pgvector.vector-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildClient(): QdrantClient {
  return {
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn().mockResolvedValue(undefined),
    deleteCollection: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as QdrantClient;
}

describe('QdrantVectorStore', () => {
  let client: QdrantClient;
  let store: QdrantVectorStore;

  beforeEach(() => {
    vi.clearAllMocks();
    client = buildClient();
    store = new QdrantVectorStore(new QdrantService(client), 'test_memories');
  });

  it('exposes the qdrant backend name', () => {
    expect(store.backend).toBe('qdrant');
  });

  describe('toQdrantPointId', () => {
    it('passes an existing UUID through unchanged', () => {
      const uuid = '3f9a1c2b-4d5e-4a6f-8b7c-9d0e1f2a3b4c';
      expect(toQdrantPointId(uuid)).toBe(uuid);
    });

    it('maps a digit-only id to a deterministic v5 UUID (not a numeric string)', () => {
      // Qdrant uint point ids are JSON numbers; a numeric *string* like "42"
      // would be rejected, so digit-only ids must be mapped, not passed through.
      const derived = toQdrantPointId('42');
      expect(derived).toMatch(UUID_RE);
      expect(derived).not.toBe('42');
      expect(toQdrantPointId('42')).toBe(derived);
    });

    it('maps a CUID to a deterministic v5 UUID', () => {
      const cuid = 'ery92gktxle82gs2czpz1ofp';
      const first = toQdrantPointId(cuid);
      expect(first).toMatch(UUID_RE);
      expect(first).not.toBe(cuid);
      // Deterministic: the same memory id always yields the same point id.
      expect(toQdrantPointId(cuid)).toBe(first);
      // Distinct ids yield distinct point ids.
      expect(toQdrantPointId('cjld2cjxh0000qzrmn831i7rn')).not.toBe(first);
    });
  });

  describe('ensureReady', () => {
    it('creates the collection when it does not exist', async () => {
      await store.ensureReady(1536);
      expect(client.createCollection).toHaveBeenCalledWith('test_memories', {
        vectors: { size: 1536, distance: 'Cosine' },
      });
    });

    it('does not recreate the collection once ensured', async () => {
      await store.ensureReady(1536);
      await store.ensureReady(1536);
      expect(client.createCollection).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid dimensions', async () => {
      await expect(store.ensureReady(0)).rejects.toThrow('positive integer');
    });
  });

  describe('upsert', () => {
    it('ensures the collection then upserts points with a derived id and memoryId payload', async () => {
      await store.upsert([
        {
          id: 'mem-1',
          vector: [0.1, 0.2, 0.3],
          payload: { userId: 'user-1', type: 'long-term', tags: ['a'] },
        },
      ]);

      expect(client.createCollection).toHaveBeenCalledTimes(1);
      expect(client.upsert).toHaveBeenCalledWith('test_memories', {
        wait: true,
        points: [
          {
            id: toQdrantPointId('mem-1'),
            vector: [0.1, 0.2, 0.3],
            payload: { userId: 'user-1', type: 'long-term', tags: ['a'], memoryId: 'mem-1' },
          },
        ],
      });
    });

    it('stores memoryId even when the record has no payload', async () => {
      await store.upsert([{ id: 'mem-2', vector: [0.1, 0.2, 0.3] }]);
      const call = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
        points: Array<{ payload: Record<string, unknown> }>;
      };
      expect(call.points[0]?.payload).toEqual({ memoryId: 'mem-2' });
    });

    it('is a no-op for an empty batch', async () => {
      await store.upsert([]);
      expect(client.upsert).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes points by derived id', async () => {
      await store.delete(['mem-1', 'mem-2']);
      expect(client.delete).toHaveBeenCalledWith('test_memories', {
        wait: true,
        points: [toQdrantPointId('mem-1'), toQdrantPointId('mem-2')],
      });
    });

    it('is a no-op for an empty id list', async () => {
      await store.delete([]);
      expect(client.delete).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('deletes the collection when it exists and forces recreation on next upsert', async () => {
      client.getCollections = vi
        .fn()
        .mockResolvedValueOnce({ collections: [{ name: 'test_memories' }] }) // reset() existence check
        .mockResolvedValue({ collections: [] }); // subsequent ensureReady check

      await store.reset();
      expect(client.deleteCollection).toHaveBeenCalledWith('test_memories');

      // ensured flag was cleared, so the next upsert recreates the collection.
      await store.upsert([{ id: 'mem-1', vector: [0.1, 0.2, 0.3] }]);
      expect(client.createCollection).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the collection does not exist', async () => {
      client.getCollections = vi.fn().mockResolvedValue({ collections: [] });
      await store.reset();
      expect(client.deleteCollection).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('returns an empty array when the collection is missing', async () => {
      client.getCollections = vi.fn().mockResolvedValue({ collections: [] });
      const results = await store.search([0.1, 0.2], { userId: 'user-1' });
      expect(results).toEqual([]);
      expect(client.search).not.toHaveBeenCalled();
    });

    it('builds a tenant-scoped filter and maps results', async () => {
      client.getCollections = vi
        .fn()
        .mockResolvedValue({ collections: [{ name: 'test_memories' }] });
      client.search = vi
        .fn()
        .mockResolvedValue([{ id: 'mem-9', score: 0.87, payload: { userId: 'user-1' } }]);

      const results = await store.search(
        [0.1, 0.2],
        { userId: 'user-1', scope: 'session-1', type: 'long-term', tags: ['x', 'y'] },
        5
      );

      expect(client.search).toHaveBeenCalledWith('test_memories', {
        vector: [0.1, 0.2],
        limit: 5,
        with_payload: true,
        filter: {
          must: [
            { key: 'userId', match: { value: 'user-1' } },
            { key: 'scope', match: { value: 'session-1' } },
            { key: 'type', match: { value: 'long-term' } },
            { key: 'tags', match: { any: ['x', 'y'] } },
          ],
        },
      });
      expect(results).toEqual([{ id: 'mem-9', score: 0.87, payload: { userId: 'user-1' } }]);
    });

    it('returns payload.memoryId as the hit id when present (derived point id)', async () => {
      const cuid = 'ery92gktxle82gs2czpz1ofp';
      client.getCollections = vi
        .fn()
        .mockResolvedValue({ collections: [{ name: 'test_memories' }] });
      client.search = vi.fn().mockResolvedValue([
        {
          id: toQdrantPointId(cuid), // point id is the derived UUID, not the CUID
          score: 0.99,
          payload: { userId: 'user-1', memoryId: cuid },
        },
      ]);

      const results = await store.search([0.1, 0.2], { userId: 'user-1' });
      // Caller receives the real memory id, not the derived point id.
      expect(results[0]?.id).toBe(cuid);
    });

    it('requires a userId for isolation', async () => {
      await expect(store.search([0.1], { userId: '' })).rejects.toThrow('tenant isolation');
    });

    it('adds a createdAt range clause for time-range filters', async () => {
      client.getCollections = vi
        .fn()
        .mockResolvedValue({ collections: [{ name: 'test_memories' }] });
      client.search = vi.fn().mockResolvedValue([]);

      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date('2026-02-01T00:00:00.000Z');
      await store.search([0.1, 0.2], { userId: 'user-1', createdFrom: from, createdTo: to }, 5);

      expect(client.search).toHaveBeenCalledWith('test_memories', {
        vector: [0.1, 0.2],
        limit: 5,
        with_payload: true,
        filter: {
          must: [
            { key: 'userId', match: { value: 'user-1' } },
            { key: 'createdAt', range: { gte: from.getTime(), lte: to.getTime() } },
          ],
        },
      });
    });

    it('supports an open-ended (lower-bound only) time range', async () => {
      client.getCollections = vi
        .fn()
        .mockResolvedValue({ collections: [{ name: 'test_memories' }] });
      client.search = vi.fn().mockResolvedValue([]);

      const from = new Date('2026-01-01T00:00:00.000Z');
      await store.search([0.1], { userId: 'user-1', createdFrom: from });

      expect(client.search).toHaveBeenCalledWith('test_memories', {
        vector: [0.1],
        limit: 10,
        with_payload: true,
        filter: {
          must: [
            { key: 'userId', match: { value: 'user-1' } },
            { key: 'createdAt', range: { gte: from.getTime() } },
          ],
        },
      });
    });
  });
});

describe('PgVectorStore', () => {
  function buildClient(rows: unknown[] = []): PgVectorClient & {
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  } {
    return {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      $queryRawUnsafe: vi.fn().mockResolvedValue(rows),
    };
  }

  it('exposes the pgvector backend name', () => {
    const store = new PgVectorStore(buildClient(), 1536);
    expect(store.backend).toBe('pgvector');
  });

  it('rejects a non-positive dimensions value at construction', () => {
    expect(() => new PgVectorStore(buildClient(), 0)).toThrow('positive integer');
  });

  describe('ensureReady', () => {
    it('creates the extension, column, and HNSW index idempotently', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);

      await store.ensureReady(3);
      await store.ensureReady(3);

      const statements = client.$executeRawUnsafe.mock.calls.map((call) => String(call[0]));
      expect(statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(
        true
      );
      expect(
        statements.some((s) => s.includes('ADD COLUMN IF NOT EXISTS "embedding_vec" vector(3)'))
      ).toBe(true);
      expect(statements.some((s) => s.includes('USING hnsw'))).toBe(true);
      // Idempotent: the three DDL statements run only once across both calls.
      expect(client.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    });

    it('rejects invalid dimensions', async () => {
      const store = new PgVectorStore(buildClient(), 3);
      await expect(store.ensureReady(0)).rejects.toThrow('positive integer');
    });
  });

  describe('upsert', () => {
    it('ensures readiness then updates each row with a vector literal', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);

      await store.upsert([
        { id: 'mem-1', vector: [0.1, 0.2, 0.3] },
        { id: 'mem-2', vector: [0.4, 0.5, 0.6] },
      ]);

      const updates = client.$executeRawUnsafe.mock.calls.filter((call) =>
        String(call[0]).startsWith('UPDATE')
      );
      expect(updates).toHaveLength(2);
      expect(updates[0]?.[1]).toBe('[0.1,0.2,0.3]');
      expect(updates[0]?.[2]).toBe('mem-1');
    });

    it('rejects non-finite vector values', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);
      await expect(store.upsert([{ id: 'mem-1', vector: [0.1, Number.NaN, 0.3] }])).rejects.toThrow(
        'finite'
      );
    });

    it('is a no-op for an empty batch', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);
      await store.upsert([]);
      expect(client.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('nulls the vector column for the given ids', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);

      await store.delete(['mem-1', 'mem-2']);

      expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('SET "embedding_vec" = NULL WHERE "id" = ANY($1::text[])'),
        ['mem-1', 'mem-2']
      );
    });

    it('is a no-op for an empty id list', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);
      await store.delete([]);
      expect(client.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('nulls the vector column across every row', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);

      await store.reset();

      expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE "memories" SET "embedding_vec" = NULL'
      );
    });
  });

  describe('search', () => {
    it('builds a tenant-scoped cosine kNN query and maps rows', async () => {
      const createdAt = new Date('2026-01-15T00:00:00.000Z');
      const client = buildClient([
        {
          id: 'mem-9',
          userId: 'user-1',
          type: 'long-term',
          tags: ['x'],
          scope: 'session-1',
          createdAt,
          score: 0.87,
        },
      ]);
      const store = new PgVectorStore(client, 3);

      const results = await store.search(
        [0.1, 0.2, 0.3],
        { userId: 'user-1', type: 'long-term', scope: 'session-1', tags: ['x'] },
        5
      );

      const [sql, ...params] = client.$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
      expect(sql).toContain('1 - ("embedding_vec" <=> $1::vector) AS score');
      expect(sql).toContain('ORDER BY "embedding_vec" <=> $1::vector LIMIT 5');
      expect(sql).toContain('"userId" = $2');
      expect(sql).toContain('"tags" @> $5::text[]');
      expect(params[0]).toBe('[0.1,0.2,0.3]');
      expect(params).toContain('user-1');
      expect(results).toEqual([
        {
          id: 'mem-9',
          score: 0.87,
          payload: {
            userId: 'user-1',
            tags: ['x'],
            type: 'long-term',
            scope: 'session-1',
            createdAt: createdAt.getTime(),
          },
        },
      ]);
    });

    it('adds created-time range clauses when provided', async () => {
      const client = buildClient([]);
      const store = new PgVectorStore(client, 3);

      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date('2026-02-01T00:00:00.000Z');
      await store.search([0.1, 0.2, 0.3], { userId: 'user-1', createdFrom: from, createdTo: to });

      const [sql, ...params] = client.$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
      expect(sql).toContain('"createdAt" >= $');
      expect(sql).toContain('"createdAt" <= $');
      expect(params).toContain(from);
      expect(params).toContain(to);
    });

    it('coerces string scores from the driver to numbers', async () => {
      const client = buildClient([
        {
          id: 'mem-1',
          userId: 'user-1',
          type: null,
          tags: null,
          scope: null,
          createdAt: null,
          score: '0.5',
        },
      ]);
      const store = new PgVectorStore(client, 3);

      const results = await store.search([0.1, 0.2, 0.3], { userId: 'user-1' });
      expect(results[0]?.score).toBe(0.5);
      expect(results[0]?.payload?.tags).toEqual([]);
    });

    it('requires a userId for isolation', async () => {
      const store = new PgVectorStore(buildClient(), 3);
      await expect(store.search([0.1], { userId: '' })).rejects.toThrow('tenant isolation');
    });
  });

  describe('HNSW tuning', () => {
    it('rejects out-of-range tuning parameters at construction', () => {
      expect(() => new PgVectorStore(buildClient(), 3, undefined, undefined, { m: 1 })).toThrow(
        'HNSW m'
      );
      expect(
        () => new PgVectorStore(buildClient(), 3, undefined, undefined, { efConstruction: 2 })
      ).toThrow('ef_construction');
      expect(
        () => new PgVectorStore(buildClient(), 3, undefined, undefined, { efSearch: 0 })
      ).toThrow('ef_search');
    });

    it('bakes build-time parameters into the index DDL', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3, undefined, undefined, {
        m: 16,
        efConstruction: 64,
      });

      await store.ensureReady(3);

      const indexStatement = client.$executeRawUnsafe.mock.calls
        .map((call) => String(call[0]))
        .find((s) => s.includes('USING hnsw'));
      expect(indexStatement).toContain('WITH (m = 16, ef_construction = 64)');
    });

    it('omits the WITH clause when no build params are configured', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);

      await store.ensureReady(3);

      const indexStatement = client.$executeRawUnsafe.mock.calls
        .map((call) => String(call[0]))
        .find((s) => s.includes('USING hnsw'));
      expect(indexStatement).not.toContain('WITH (');
    });

    it('applies ef_search before each search when configured', async () => {
      const client = buildClient([]);
      const store = new PgVectorStore(client, 3, undefined, undefined, { efSearch: 100 });

      await store.search([0.1, 0.2, 0.3], { userId: 'user-1' });

      expect(client.$executeRawUnsafe).toHaveBeenCalledWith('SET hnsw.ef_search = 100');
    });

    it('does not set ef_search when unconfigured', async () => {
      const client = buildClient([]);
      const store = new PgVectorStore(client, 3);

      await store.search([0.1, 0.2, 0.3], { userId: 'user-1' });

      const setCalls = client.$executeRawUnsafe.mock.calls
        .map((call) => String(call[0]))
        .filter((s) => s.startsWith('SET hnsw.ef_search'));
      expect(setCalls).toHaveLength(0);
    });
  });

  describe('healthCheck', () => {
    it('reports healthy when the extension and column exist', async () => {
      const client: PgVectorClient & { $queryRawUnsafe: ReturnType<typeof vi.fn> } = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([{ installed: true }])
          .mockResolvedValueOnce([{ present: true }]),
      };
      const store = new PgVectorStore(client, 3);

      await expect(store.healthCheck()).resolves.toEqual({
        ok: true,
        extension: true,
        column: true,
      });
    });

    it('reports unhealthy when the extension is missing', async () => {
      const client: PgVectorClient & { $queryRawUnsafe: ReturnType<typeof vi.fn> } = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([{ installed: false }])
          .mockResolvedValueOnce([{ present: true }]),
      };
      const store = new PgVectorStore(client, 3);

      const result = await store.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.extension).toBe(false);
    });
  });
});
