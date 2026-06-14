import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QdrantVectorStore } from './qdrant.vector-store';
import { PgVectorStore } from './pgvector.vector-store';

const ORG_A = 'cm0aaaaaaaaaaaaaaaaaaaaaaaa';
const ORG_B = 'cm0bbbbbbbbbbbbbbbbbbbbbbbbb';
const USER_A = 'cldx4k8xp000108l83h4y8v2q';
const VEC = [0.1, 0.2, 0.3];

// ---------------------------------------------------------------------------
// Qdrant tenant-isolation tests (unit — no real Qdrant instance)
// ---------------------------------------------------------------------------

describe('QdrantVectorStore — tenant isolation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let qdrantClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let qdrantService: any;
  let store: QdrantVectorStore;

  beforeEach(() => {
    qdrantClient = {
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    qdrantService = {
      collectionExists: vi.fn().mockResolvedValue(true),
      createCollection: vi.fn(),
      getClient: vi.fn().mockReturnValue(qdrantClient),
      upsertPoints: vi.fn(),
    };

    store = new QdrantVectorStore(qdrantService);
  });

  it('passes organizationId filter to Qdrant search when set', async () => {
    await store.search(VEC, { userId: USER_A, organizationId: ORG_A });

    expect(qdrantClient.search).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        filter: expect.objectContaining({
          must: expect.arrayContaining([{ key: 'organizationId', match: { value: ORG_A } }]),
        }),
      })
    );
  });

  it('does not add organizationId clause when not set', async () => {
    await store.search(VEC, { userId: USER_A });

    const call = qdrantClient.search.mock.calls[0]![1];
    const mustKeys: string[] = call.filter.must.map((c: { key: string }) => c.key);
    expect(mustKeys).not.toContain('organizationId');
  });

  it('always includes userId clause', async () => {
    await store.search(VEC, { userId: USER_A, organizationId: ORG_A });

    const call = qdrantClient.search.mock.calls[0]![1];
    const mustKeys: string[] = call.filter.must.map((c: { key: string }) => c.key);
    expect(mustKeys).toContain('userId');
  });

  it('throws when userId is missing', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.search(VEC, { userId: '' } as any)
    ).rejects.toThrow('userId');
  });

  it('throws when organizationId is provided as empty string', async () => {
    await expect(store.search(VEC, { userId: USER_A, organizationId: '' })).rejects.toThrow(
      'organizationId must not be empty when provided'
    );
  });

  it('org A and org B filters are distinct', async () => {
    await store.search(VEC, { userId: USER_A, organizationId: ORG_A });
    await store.search(VEC, { userId: USER_A, organizationId: ORG_B });

    const callA = qdrantClient.search.mock.calls[0]![1];
    const callB = qdrantClient.search.mock.calls[1]![1];

    const orgFilterA = callA.filter.must.find((c: { key: string }) => c.key === 'organizationId');
    const orgFilterB = callB.filter.must.find((c: { key: string }) => c.key === 'organizationId');

    expect(orgFilterA.match.value).toBe(ORG_A);
    expect(orgFilterB.match.value).toBe(ORG_B);
    expect(orgFilterA.match.value).not.toBe(orgFilterB.match.value);
  });

  it('upserted payload carries organizationId', async () => {
    qdrantService.collectionExists.mockResolvedValueOnce(false);
    await store.upsert([
      {
        id: 'mem-1',
        vector: VEC,
        payload: { userId: USER_A, organizationId: ORG_A },
      },
    ]);

    expect(qdrantService.upsertPoints).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ organizationId: ORG_A }),
        }),
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// pgvector tenant-isolation tests (unit — mocked Prisma client)
// ---------------------------------------------------------------------------

describe('PgVectorStore — tenant isolation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let store: PgVectorStore;

  beforeEach(() => {
    client = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };
    // Mark as ensured so upsert/search skip DDL
    store = new PgVectorStore(client, 3);
    // @ts-expect-error — accessing private field for test setup
    store.ensured = true;
  });

  it('includes organizationId clause in SQL when filter set', async () => {
    await store.search(VEC, { userId: USER_A, organizationId: ORG_A });

    const sql: string = client.$queryRawUnsafe.mock.calls[0]![0];
    expect(sql).toContain('"organizationId"');
  });

  it('omits organizationId WHERE clause from SQL when not set', async () => {
    await store.search(VEC, { userId: USER_A });

    const sql: string = client.$queryRawUnsafe.mock.calls[0]![0];
    // The column is always projected in SELECT; what must be absent is the filter predicate.
    expect(sql).not.toContain('"organizationId" =');
  });

  it('passes organizationId as a bound parameter', async () => {
    await store.search(VEC, { userId: USER_A, organizationId: ORG_A });

    const args: unknown[] = client.$queryRawUnsafe.mock.calls[0]!.slice(1);
    expect(args).toContain(ORG_A);
  });

  it('org A and org B are passed as distinct parameters', async () => {
    await store.search(VEC, { userId: USER_A, organizationId: ORG_A });
    await store.search(VEC, { userId: USER_A, organizationId: ORG_B });

    const argsA: unknown[] = client.$queryRawUnsafe.mock.calls[0]!.slice(1);
    const argsB: unknown[] = client.$queryRawUnsafe.mock.calls[1]!.slice(1);

    expect(argsA).toContain(ORG_A);
    expect(argsA).not.toContain(ORG_B);
    expect(argsB).toContain(ORG_B);
    expect(argsB).not.toContain(ORG_A);
  });

  it('mapRow includes organizationId in result payload', async () => {
    client.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: 'mem-1',
        userId: USER_A,
        organizationId: ORG_A,
        type: 'long-term',
        tags: [],
        scope: null,
        createdAt: new Date(),
        score: 0.9,
      },
    ]);

    const results = await store.search(VEC, { userId: USER_A, organizationId: ORG_A });
    expect(results).toHaveLength(1);
    expect(results[0]!.payload?.organizationId).toBe(ORG_A);
  });

  it('mapRow omits organizationId from payload when null', async () => {
    client.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: 'mem-2',
        userId: USER_A,
        organizationId: null,
        type: 'long-term',
        tags: [],
        scope: null,
        createdAt: new Date(),
        score: 0.8,
      },
    ]);

    const results = await store.search(VEC, { userId: USER_A });
    expect(results).toHaveLength(1);
    expect(results[0]!.payload).not.toHaveProperty('organizationId');
  });

  it('throws when organizationId is provided as empty string', async () => {
    await expect(store.search(VEC, { userId: USER_A, organizationId: '' })).rejects.toThrow(
      'organizationId must not be empty when provided'
    );
  });
});
