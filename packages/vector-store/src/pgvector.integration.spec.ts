import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgVectorStore, type PgVectorClient } from './pgvector.vector-store';

/**
 * Live pgvector integration test.
 *
 * Skipped unless `PGVECTOR_TEST_URL` points at a pgvector-enabled Postgres
 * instance (the CI `postgres:16-alpine`-style images without the extension are
 * not sufficient — use `pgvector/pgvector:pg16`). Run locally with:
 *
 *   PGVECTOR_TEST_URL=postgresql://test:test@localhost:5432/engram_test \
 *     pnpm --filter @engram/vector-store test
 */
const connectionString = process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

const DIMENSIONS = 8;
const USER_ID = 'pgvector-integration-user';

function unitVector(seed: number): number[] {
  const raw = Array.from({ length: DIMENSIONS }, (_, index) => Math.sin(seed * (index + 1)));
  const magnitude = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
  return raw.map((value) => value / magnitude);
}

describePg('PgVectorStore (integration)', () => {
  // Dynamic import keeps @prisma/client out of the unit-test path.
  let prisma: PgVectorClient & {
    $disconnect(): Promise<void>;
    $executeRawUnsafe: PgVectorClient['$executeRawUnsafe'];
  };
  let store: PgVectorStore;
  const ids = ['pgvec-int-1', 'pgvec-int-2', 'pgvec-int-3'];

  beforeAll(async () => {
    const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
      import('@prisma/client'),
      import('@prisma/adapter-pg'),
    ]);
    // Prisma v7 uses a WASM client engine that requires a driver adapter.
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    }) as unknown as typeof prisma;

    // The migrations table already exists in CI; seed a test user for the FK
    // and insert stub memory rows so the vector store has rows to operate on.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "email", "updatedAt")
       VALUES ($1, $2, now())
       ON CONFLICT ("id") DO NOTHING`,
      USER_ID,
      'pgvector-integration@test.local'
    );

    store = new PgVectorStore(prisma, DIMENSIONS);
    await store.ensureReady(DIMENSIONS);

    for (let index = 0; index < ids.length; index += 1) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "memories" ("id", "userId", "content", "type", "tags", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT ("id") DO UPDATE SET "userId" = EXCLUDED."userId"`,
        ids[index],
        USER_ID,
        '',
        'note',
        ['integration']
      );
    }
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "id" = ANY($1::text[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1`, USER_ID);
    await prisma.$disconnect();
  });

  it('upserts vectors and returns the nearest neighbour first', async () => {
    await store.upsert([
      { id: ids[0]!, vector: unitVector(1), payload: { userId: USER_ID, tags: ['integration'] } },
      { id: ids[1]!, vector: unitVector(5), payload: { userId: USER_ID, tags: ['integration'] } },
      { id: ids[2]!, vector: unitVector(9), payload: { userId: USER_ID, tags: ['integration'] } },
    ]);

    const results = await store.search(unitVector(1), { userId: USER_ID }, 3);

    expect(results.length).toBe(3);
    expect(results[0]!.id).toBe(ids[0]);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score - 1e-6);
    expect(results.every((result) => result.payload.userId === USER_ID)).toBe(true);
  });

  it('isolates results by userId', async () => {
    const results = await store.search(unitVector(1), { userId: 'someone-else' }, 3);
    expect(results.length).toBe(0);
  });

  it('clears vectors on delete', async () => {
    await store.delete([ids[0]!]);
    const results = await store.search(unitVector(1), { userId: USER_ID }, 3);
    expect(results.some((result) => result.id === ids[0])).toBe(false);
  });
});
