import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PgVectorStore } from './pgvector.vector-store';

const ORG_A = 'cm0aaaaaaaaaaaaaaaaaaaaaaaa';
const ORG_B = 'cm0bbbbbbbbbbbbbbbbbbbbbbbbb';
const USER_A = 'cldx4k8xp000108l83h4y8v2q';
const VEC = [0.1, 0.2, 0.3];

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
