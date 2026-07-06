import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryLtmService } from './memory-ltm.service';

/**
 * Live-Postgres proof for the WP2 T5/G5 restore path — the headline recovery
 * capability, which the unit tests only exercise with a mocked Prisma.
 *
 * It verifies the one thing mocks cannot: that `restore()` passing an EXPLICIT id
 * through the advisory-lock quota transaction (`createRowWithQuota`) actually
 * lands a row under that exact id in real Postgres (overriding the
 * `@default(cuid(2))`), and that the quota count reflects it. A restore that
 * silently minted a fresh id would break id-keyed vector upserts and inbound
 * links — the kind of bug "mock-green" hides.
 *
 * Skipped unless a migrated ENGRAM Postgres is reachable (reuses the CI database
 * via `PGVECTOR_TEST_URL`, or set `LTM_RESTORE_TEST_URL`).
 */
const connectionString = process.env.LTM_RESTORE_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

const USER_ID = 'cltmrestore00000000000001';
const RESTORE_ID = 'cltmrestoredid0000000001';

describePg('MemoryLtmService.restore (integration)', () => {
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
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    }) as unknown as typeof prisma;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "email", "updatedAt")
       VALUES ($1, $2, now()) ON CONFLICT ("id") DO NOTHING`,
      USER_ID,
      'ltm-restore@test.local'
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);

    service = new MemoryLtmService(prisma as never);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1`, USER_ID);
    await prisma.$disconnect();
  });

  it('recreates a memory under its ORIGINAL id via the quota transaction', async () => {
    const restored = await service.restore({
      id: RESTORE_ID,
      userId: USER_ID,
      content: 'recovered from a delete snapshot',
      tags: ['restored', 'integration'],
      metadata: { source: 'restore-test' },
      scope: 'project:restore',
    });

    // The row exists at the exact preserved id — not a freshly-minted cuid.
    expect(restored.id).toBe(RESTORE_ID);
    expect(restored.type).toBe('long-term');
    expect(restored.content).toBe('recovered from a delete snapshot');
    expect(restored.scope).toBe('project:restore');
    expect(restored.version).toBe(1);

    // Quota accounting reflects exactly the restored row.
    const count = await prisma.memory.count({
      where: { userId: USER_ID, type: 'long-term' },
    });
    expect(count).toBe(1);

    // A second restore with the same id must fail (unique id) rather than
    // silently duplicating — surfaced as a database error, not a fresh row.
    await expect(
      service.restore({ id: RESTORE_ID, userId: USER_ID, content: 'dup' })
    ).rejects.toBeTruthy();
    const countAfter = await prisma.memory.count({
      where: { userId: USER_ID, type: 'long-term' },
    });
    expect(countAfter).toBe(1);
  });
});
