import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * SHARED-2 schema round-trip (WP2): proves the `memory-version-audit` migration
 * end-to-end against a real Postgres via the generated Prisma client.
 *
 * Asserts three schema-level facts the rest of WP2 builds on:
 *  - `Memory.version` defaults to 1 on create (backs T4 optimistic concurrency),
 *  - a `version: { increment: 1 }` update advances it (the CAS mechanic),
 *  - `MemoryAudit` rows round-trip with no FK to `Memory` (backs T5 audit/restore —
 *    audit rows must survive hard deletes).
 *
 * Skipped unless a migrated ENGRAM Postgres is reachable. Reuses the CI database
 * advertised via `PGVECTOR_TEST_URL` (any migrated Postgres works — pgvector itself
 * is not needed here), or set `MEMORY_VERSION_TEST_URL` explicitly:
 *
 *   MEMORY_VERSION_TEST_URL=postgresql://engram:...@localhost:5432/engram \
 *     pnpm --filter @engram/memory-ltm test
 */
const connectionString = process.env.MEMORY_VERSION_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

// CUID-shaped id, unlikely to collide with real data.
const USER_ID = 'clshared2version00000001';

describePg('SHARED-2 Memory.version + MemoryAudit round-trip (integration)', () => {
  // Dynamic import keeps @prisma/client out of the unit-test path.
  let prisma: {
    memory: {
      create(args: unknown): Promise<{ id: string; version: number }>;
      update(args: unknown): Promise<{ id: string; version: number }>;
    };
    memoryAudit: {
      create(args: unknown): Promise<{ id: string }>;
      findUnique(args: unknown): Promise<Record<string, unknown> | null>;
      deleteMany(args: unknown): Promise<{ count: number }>;
    };
    $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
    $disconnect(): Promise<void>;
  };

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
      'shared2-version@test.local'
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "memory_audits" WHERE "userId" = $1`, USER_ID);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "memory_audits" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1`, USER_ID);
    await prisma.$disconnect();
  });

  it('defaults version to 1 on create and increments on update', async () => {
    const created = await prisma.memory.create({
      data: {
        userId: USER_ID,
        content: 'shared-2 version default',
        type: 'long-term',
        tags: [],
        embedding: [],
      },
      select: { id: true, version: true },
    });
    expect(created.version).toBe(1);

    const bumped = await prisma.memory.update({
      where: { id: created.id },
      data: { version: { increment: 1 } },
      select: { id: true, version: true },
    });
    expect(bumped.version).toBe(2);
  });

  it('round-trips a MemoryAudit row (no FK to Memory — survives hard deletes)', async () => {
    const audit = await prisma.memoryAudit.create({
      data: {
        memoryId: 'a-memory-id-that-does-not-exist',
        userId: USER_ID,
        action: 'delete',
        actorType: 'api-key',
        actorId: 'apikey-123',
        actorLabel: 'op@example.com',
        delegated: true,
        before: { content: 'gone now', tags: ['x'], version: 3 },
        after: { deleted: true },
      },
      select: { id: true },
    });

    const read = await prisma.memoryAudit.findUnique({ where: { id: audit.id } });
    expect(read).toMatchObject({
      userId: USER_ID,
      action: 'delete',
      actorType: 'api-key',
      delegated: true,
      before: { content: 'gone now', tags: ['x'], version: 3 },
      after: { deleted: true },
    });
    // The referenced memory never existed — the row persists regardless (no FK).
    expect(read?.memoryId).toBe('a-memory-id-that-does-not-exist');
  });
});
