import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PgVectorStore, type PgVectorClient } from './pgvector.vector-store';

describe('PgVectorStore provisioning race', () => {
  function buildRaceClient(): PgVectorClient & {
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  } {
    return {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as never;
  }

  it('retries provisioning after a transient DDL failure (concurrent boot)', async () => {
    const client = buildRaceClient();
    // First ALTER TABLE loses a lock race; every statement is IF NOT EXISTS,
    // so the retry must converge.
    client.$executeRawUnsafe
      .mockResolvedValueOnce(0) // CREATE EXTENSION
      .mockRejectedValueOnce(Object.assign(new Error('deadlock detected'), { code: '40P01' }));
    const store = new PgVectorStore(client);

    await expect(store.ensureReady(768)).resolves.toBeUndefined();
    const statements = client.$executeRawUnsafe.mock.calls.map((call) => call[0] as string);
    expect(statements.filter((sql) => sql.includes('ADD COLUMN')).length).toBe(2);
  });

  it('does not retry the dimension-mismatch operator error', async () => {
    const client = buildRaceClient();
    client.$queryRawUnsafe.mockResolvedValue([{ atttypmod: 1536 }]);
    const store = new PgVectorStore(client);

    await expect(store.ensureReady(768)).rejects.toThrow('recreate+regenerate');
    // One attempt only: CREATE EXTENSION + ADD COLUMN, then the guard throws.
    const statements = client.$executeRawUnsafe.mock.calls.map((call) => call[0] as string);
    expect(statements.filter((sql) => sql.includes('ADD COLUMN')).length).toBe(1);
  });

  it('gives up after exhausting retries', async () => {
    const client = buildRaceClient();
    client.$executeRawUnsafe.mockRejectedValue(new Error('connection refused'));
    const store = new PgVectorStore(client);

    await expect(store.ensureReady(768)).rejects.toThrow('connection refused');
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

  it('accepts construction without a dimensions pin', () => {
    expect(() => new PgVectorStore(buildClient())).not.toThrow();
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

    it('throws an actionable error when the live column has different dimensions', async () => {
      const client = buildClient([{ atttypmod: 1536 }]);
      const store = new PgVectorStore(client);

      await expect(store.ensureReady(768)).rejects.toThrow(/vector\(1536\).*768-dim/s);
      await expect(store.ensureReady(768)).rejects.toThrow('recreate+regenerate');
    });

    it('accepts a live column whose dimensions match', async () => {
      const client = buildClient([{ atttypmod: 768 }]);
      const store = new PgVectorStore(client);

      await expect(store.ensureReady(768)).resolves.toBeUndefined();
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

    it('infers dimensions from the first vector when no pin is configured', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client);

      await store.upsert([{ id: 'mem-1', vector: [0.1, 0.2, 0.3, 0.4] }]);

      const statements = client.$executeRawUnsafe.mock.calls.map((call) => String(call[0]));
      expect(
        statements.some((s) => s.includes('ADD COLUMN IF NOT EXISTS "embedding_vec" vector(4)'))
      ).toBe(true);
    });

    it('rejects vectors that do not match the configured VECTOR_DIMENSIONS pin', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client, 3);

      await expect(store.upsert([{ id: 'mem-1', vector: [0.1, 0.2] }])).rejects.toThrow(
        'VECTOR_DIMENSIONS pin of 3'
      );
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

    it('swallows undefined-column errors (column not provisioned yet)', async () => {
      const client = buildClient();
      client.$executeRawUnsafe = vi
        .fn()
        .mockRejectedValue(
          new Error('column "embedding_vec" of relation "memories" does not exist')
        );
      const store = new PgVectorStore(client, 3);

      await expect(store.delete(['mem-1'])).resolves.toBeUndefined();
    });
  });

  describe('reset', () => {
    it('drops the index and column so the next upsert reprovisions at new dimensions', async () => {
      const client = buildClient();
      const store = new PgVectorStore(client);

      await store.upsert([{ id: 'mem-1', vector: [0.1, 0.2, 0.3] }]);
      await store.reset();

      const statements = client.$executeRawUnsafe.mock.calls.map((call) => String(call[0]));
      expect(statements).toContain('DROP INDEX IF EXISTS "memories_embedding_vec_hnsw"');
      expect(statements).toContain('ALTER TABLE "memories" DROP COLUMN IF EXISTS "embedding_vec"');

      // ensured flag cleared: a subsequent upsert at NEW dimensions reprovisions.
      await store.upsert([{ id: 'mem-1', vector: [0.1, 0.2, 0.3, 0.4] }]);
      const afterReset = client.$executeRawUnsafe.mock.calls.map((call) => String(call[0]));
      expect(
        afterReset.some((s) => s.includes('ADD COLUMN IF NOT EXISTS "embedding_vec" vector(4)'))
      ).toBe(true);
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

    it('returns an empty array when the column is not provisioned yet', async () => {
      const client = buildClient();
      client.$queryRawUnsafe = vi
        .fn()
        .mockRejectedValue(new Error('column "embedding_vec" does not exist'));
      const store = new PgVectorStore(client, 3);

      await expect(store.search([0.1, 0.2, 0.3], { userId: 'user-1' })).resolves.toEqual([]);
    });

    it('rethrows non-column search errors', async () => {
      const client = buildClient();
      client.$queryRawUnsafe = vi.fn().mockRejectedValue(new Error('connection refused'));
      const store = new PgVectorStore(client, 3);

      await expect(store.search([0.1, 0.2, 0.3], { userId: 'user-1' })).rejects.toThrow(
        'connection refused'
      );
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
    it('reports healthy with live dimensions when the extension and column exist', async () => {
      const client: PgVectorClient & { $queryRawUnsafe: ReturnType<typeof vi.fn> } = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([{ installed: true }])
          .mockResolvedValueOnce([{ present: true }])
          .mockResolvedValueOnce([{ atttypmod: 768 }]),
      };
      const store = new PgVectorStore(client, 3);

      await expect(store.healthCheck()).resolves.toEqual({
        ok: true,
        extension: true,
        column: true,
        dimensions: 768,
      });
    });

    it('stays healthy when the runtime-managed column is not provisioned yet', async () => {
      const client: PgVectorClient & { $queryRawUnsafe: ReturnType<typeof vi.fn> } = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([{ installed: true }])
          .mockResolvedValueOnce([{ present: false }]),
      };
      const store = new PgVectorStore(client, 3);

      await expect(store.healthCheck()).resolves.toEqual({
        ok: true,
        extension: true,
        column: false,
        dimensions: null,
      });
    });

    it('reports unhealthy when the extension is missing', async () => {
      const client: PgVectorClient & { $queryRawUnsafe: ReturnType<typeof vi.fn> } = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([{ installed: false }])
          .mockResolvedValueOnce([{ present: true }])
          .mockResolvedValueOnce([{ atttypmod: 768 }]),
      };
      const store = new PgVectorStore(client, 3);

      const result = await store.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.extension).toBe(false);
    });
  });
});
