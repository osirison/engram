import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CorpusConsolidationService } from './corpus-consolidation.service';
import { MemoryLtmService } from './memory-ltm.service';
import { ContradictionDetectionService } from './contradiction-detection.service';

/**
 * G3-T2 happy path against a real Postgres: three near-duplicates collapse to
 * one canonical (highest importance) with unioned tags; the two losers carry
 * the exact write-time supersede markers (status/supersededBy/...), a derived
 * `duplicate-of` MemoryLink to the canonical, and a `corpus_consolidation`
 * system-actor audit row — all through real version-CAS writes. A second run
 * is a no-op (idempotence). The vector store is mocked (similarity comes from
 * the store; the correctness under test is the Postgres mutation protocol).
 *
 * Skipped unless a migrated ENGRAM Postgres is reachable (reuses the CI
 * database via `PGVECTOR_TEST_URL`, or set `LTM_CONSOLIDATION_TEST_URL`).
 */
const connectionString = process.env.LTM_CONSOLIDATION_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

const USER_ID = 'cltmconsolidate0000000001';
const SEED_ID = 'cltmconsolidatemem0000001';
const CANONICAL_ID = 'cltmconsolidatemem0000002';
const LOSER_ID = 'cltmconsolidatemem0000003';

describePg('CorpusConsolidationService merge round trip (integration, G3-T2)', () => {
  let prisma: {
    memory: {
      create(args: unknown): Promise<{ id: string; version: number }>;
      findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    };
    memoryAudit: {
      findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    };
    memoryLink: {
      findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    };
    $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
    $disconnect(): Promise<void>;
  };
  let service: CorpusConsolidationService;

  const cleanup = async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "memory_links" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "memory_audits" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);
  };

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
      'corpus-consolidation@test.local'
    );
    await cleanup();

    // Mocked vector store: for any seed search, report the OTHER two rows as
    // in-band near-duplicates ([0.85, 0.97) similarity).
    const vectorStore = {
      backend: 'pgvector' as const,
      upsert: vi.fn(),
      delete: vi.fn(),
      ensureReady: vi.fn(),
      search: vi.fn().mockImplementation(async () => [
        { id: SEED_ID, score: 0.95 },
        { id: CANONICAL_ID, score: 0.93 },
        { id: LOSER_ID, score: 0.9 },
      ]),
    };

    service = new CorpusConsolidationService(
      prisma as never,
      new MemoryLtmService(prisma as never),
      new ContradictionDetectionService(),
      vectorStore as never
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1`, USER_ID);
    await prisma.$disconnect();
  });

  it('merges three near-dupes into one canonical with real CAS writes, links, and audits', async () => {
    const embedding = [0.1, 0.2, 0.3];
    await prisma.memory.create({
      data: {
        id: SEED_ID,
        userId: USER_ID,
        content: 'pnpm install runs from the repo root',
        type: 'long-term',
        tags: ['tooling'],
        metadata: { importance: 0.4 },
        embedding,
      },
    });
    await prisma.memory.create({
      data: {
        id: CANONICAL_ID,
        userId: USER_ID,
        content: 'run pnpm install from the repository root',
        type: 'long-term',
        tags: ['setup'],
        metadata: { importance: 0.9 },
        embedding,
      },
    });
    await prisma.memory.create({
      data: {
        id: LOSER_ID,
        userId: USER_ID,
        content: 'install deps with pnpm install at the root',
        type: 'long-term',
        tags: ['tooling', 'deps'],
        metadata: { importance: 0.2 },
        embedding,
      },
    });

    const result = await service.run({ userId: USER_ID, dryRun: false });

    expect(result).toMatchObject({
      scanned: 3,
      clusters: 1,
      merged: 2,
      skippedConcurrentEdit: 0,
      cursor: null,
      dryRun: false,
    });
    expect(result.perCluster[0]).toMatchObject({
      canonicalId: CANONICAL_ID,
      loserIds: expect.arrayContaining([SEED_ID, LOSER_ID]),
    });

    // Canonical: tags unioned, version bumped by the CAS write, NOT superseded.
    const canonical = await prisma.memory.findUnique({ where: { id: CANONICAL_ID } });
    expect(canonical).toMatchObject({ version: 2 });
    expect(canonical!.tags).toEqual(['setup', 'tooling', 'deps']);
    expect((canonical!.metadata as Record<string, unknown>)['supersededBy']).toBeUndefined();

    // Losers: exact write-time supersede markers, version bumped.
    for (const loserId of [SEED_ID, LOSER_ID]) {
      const loser = await prisma.memory.findUnique({ where: { id: loserId } });
      expect(loser).toMatchObject({ version: 2 });
      expect(loser!.metadata).toMatchObject({
        status: 'superseded',
        supersededBy: CANONICAL_ID,
        supersededReason: expect.stringContaining('near-duplicate consolidation'),
      });
    }

    // Derived duplicate-of links loser → canonical.
    const links = await prisma.memoryLink.findMany({ where: { userId: USER_ID } });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toMatchObject({
        targetMemoryId: CANONICAL_ID,
        targetLocator: `id:${CANONICAL_ID}`,
        relType: 'duplicate-of',
        origin: 'derived',
      });
    }
    expect(links.map((link) => link.sourceMemoryId).sort()).toEqual([SEED_ID, LOSER_ID].sort());

    // System-actor supersede audit rows with restore-shaped pre-images.
    const audits = await prisma.memoryAudit.findMany({
      where: { userId: USER_ID, action: 'supersede' },
    });
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit).toMatchObject({
        actorType: 'system',
        actorId: 'corpus_consolidation',
        delegated: false,
      });
      const before = audit.before as { content: string; version: number };
      expect(before.content.length).toBeGreaterThan(0);
      expect(before.version).toBe(1);
    }
  });

  it('is idempotent: a second real run merges nothing further', async () => {
    const result = await service.run({ userId: USER_ID, dryRun: false });

    expect(result).toMatchObject({ clusters: 0, merged: 0, skippedConcurrentEdit: 0 });

    // No extra links or audits appeared.
    expect(await prisma.memoryLink.findMany({ where: { userId: USER_ID } })).toHaveLength(2);
    expect(
      await prisma.memoryAudit.findMany({ where: { userId: USER_ID, action: 'supersede' } })
    ).toHaveLength(2);
    // Versions unmoved.
    const canonical = await prisma.memory.findUnique({ where: { id: CANONICAL_ID } });
    expect(canonical).toMatchObject({ version: 2 });
  });
});
