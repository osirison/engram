import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryLtmService } from './memory-ltm.service';
import { LtmMemoryQuotaExceededError } from './types';

/**
 * Live Postgres concurrency test for the per-user LTM quota (#203).
 *
 * Verifies that N concurrent `create()` calls cannot exceed
 * `maxMemoriesPerUser`: the advisory-lock transaction in
 * `createRowWithQuota()` serializes same-user writers, so exactly the free
 * quota slots are written and every surplus call fails with the friendly
 * `LtmMemoryQuotaExceededError`.
 *
 * Skipped unless a migrated ENGRAM Postgres is reachable. Reuses the CI
 * database advertised via `PGVECTOR_TEST_URL` (any migrated Postgres works —
 * the pgvector extension itself is not needed here), or set
 * `LTM_QUOTA_TEST_URL` explicitly. Run locally with:
 *
 *   LTM_QUOTA_TEST_URL=postgresql://test:test@localhost:5432/engram_test \
 *     pnpm --filter @engram/memory-ltm test
 */
const connectionString = process.env.LTM_QUOTA_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

// CUID1-shaped so it passes the service's userId validation.
const USER_ID = 'cltmquota203race00000001';
const QUOTA_CAP = 3;
const CONCURRENT_WRITERS = 8;

describePg('MemoryLtmService quota under concurrency (integration)', () => {
  // Dynamic import keeps @prisma/client out of the unit-test path.
  let prisma: {
    memory: { count(args: unknown): Promise<number> };
    $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
    $disconnect(): Promise<void>;
  };
  let service: MemoryLtmService;

  beforeAll(async () => {
    const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
      import('@prisma/client'),
      import('@prisma/adapter-pg'),
    ]);
    // Prisma v7 uses a WASM client engine that requires a driver adapter.
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    }) as unknown as typeof prisma;

    // Seed the test user for the memories FK; clear leftovers from prior runs.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "email", "updatedAt")
       VALUES ($1, $2, now())
       ON CONFLICT ("id") DO NOTHING`,
      USER_ID,
      'ltm-quota-race@test.local'
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);

    service = new MemoryLtmService(prisma as never);
    // Shrink the cap so the race is testable without writing 10k rows.
    (service as unknown as { config: { maxMemoriesPerUser: number } }).config.maxMemoriesPerUser =
      QUOTA_CAP;
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1`, USER_ID);
    await prisma.$disconnect();
  });

  it(
    'admits exactly the free quota slots when concurrent creates race',
    { timeout: 30_000 },
    async () => {
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_WRITERS }, (_, index) =>
          service.create({
            userId: USER_ID,
            content: `quota race memory ${index} ${Date.now()}`,
          })
        )
      );

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );

      expect(fulfilled).toHaveLength(QUOTA_CAP);
      expect(rejected).toHaveLength(CONCURRENT_WRITERS - QUOTA_CAP);
      for (const failure of rejected) {
        expect(failure.reason).toBeInstanceOf(LtmMemoryQuotaExceededError);
        expect((failure.reason as Error).message).toBe(
          `Long-term memory quota exceeded for user ${USER_ID}. Limit: ${QUOTA_CAP} memories`
        );
      }

      // Postgres is the source of truth: the cap was never exceeded.
      const stored = await prisma.memory.count({
        where: { userId: USER_ID, type: 'long-term' },
      });
      expect(stored).toBe(QUOTA_CAP);
    }
  );

  it('rejects a subsequent create once the quota is full', { timeout: 30_000 }, async () => {
    await expect(
      service.create({ userId: USER_ID, content: `one past the cap ${Date.now()}` })
    ).rejects.toBeInstanceOf(LtmMemoryQuotaExceededError);
  });
});
