import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryLtmService } from './memory-ltm.service';
import { ImportanceScoringService } from './importance.service';

/**
 * G3-T3 wiring proof against a real Postgres: a decay prune writes a
 * `memory_audits` row (system actor `ltm_decay`) whose `before` snapshot is
 * accepted by the existing restore path — i.e. exactly what
 * `findLatestDeleteSnapshot()` / `restore_memory` consume: `action='delete'`,
 * non-empty `before.content`, and the WP2 T5 `MemorySnapshot` field shape.
 * The round trip then feeds that snapshot through `restore()` and asserts the
 * memory is recreated under its ORIGINAL id.
 *
 * Skipped unless a migrated ENGRAM Postgres is reachable (reuses the CI
 * database via `PGVECTOR_TEST_URL`, or set `LTM_LIFECYCLE_TEST_URL`).
 */
const connectionString = process.env.LTM_LIFECYCLE_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

const USER_ID = 'cltmlifecycle000000000001';
const MEMORY_ID = 'cltmlifecyclemem000000001';
const DAY_MS = 86_400_000;

describePg('MemoryLtmService lifecycle audit round trip (integration, G3-T3)', () => {
  let prisma: {
    memory: {
      create(args: unknown): Promise<{ id: string; version: number }>;
      findUnique(args: unknown): Promise<Record<string, unknown> | null>;
      count(args: unknown): Promise<number>;
    };
    memoryAudit: {
      findFirst(args: unknown): Promise<Record<string, unknown> | null>;
    };
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
      'ltm-lifecycle@test.local'
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "memory_audits" WHERE "userId" = $1`, USER_ID);

    service = new MemoryLtmService(
      prisma as never,
      undefined,
      undefined,
      undefined,
      new ImportanceScoringService()
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "memory_audits" WHERE "userId" = $1`, USER_ID);
    await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1`, USER_ID);
    await prisma.$disconnect();
  });

  it('decay prune emits a restorable system audit row; restore() accepts it', async () => {
    // Seed a stale, low-importance row: 400 days old, no cues, no accesses —
    // scores far below the 0.15 prune threshold (same fixture as unit specs).
    await prisma.memory.create({
      data: {
        id: MEMORY_ID,
        userId: USER_ID,
        content: 'misc note',
        type: 'long-term',
        tags: ['integration', 'lifecycle'],
        metadata: { origin: 'g3t3-test' },
        scope: 'project:lifecycle-test',
        embedding: [],
        createdAt: new Date(Date.now() - 400 * DAY_MS),
      },
    });

    const result = await service.applyDecayPolicy({
      userId: USER_ID,
      pruneOlderThanDays: 30,
      pruneScoreThreshold: 0.15,
    });
    expect(result.pruned).toBe(1);
    expect(result.skippedConcurrentEdit).toBe(0);

    // Row is hard-deleted...
    expect(await prisma.memory.count({ where: { userId: USER_ID } })).toBe(0);

    // ...and the audit row matches what restore_memory consumes: newest
    // action='delete' row for the memory with a full pre-image snapshot.
    const audit = await prisma.memoryAudit.findFirst({
      where: { userId: USER_ID, memoryId: MEMORY_ID, action: { in: ['delete', 'bulk-delete'] } },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit).toMatchObject({
      actorType: 'system',
      actorId: 'ltm_decay',
      delegated: false,
      scope: 'project:lifecycle-test',
      after: { deleted: true, reason: 'decay_prune' },
    });
    const before = audit!.before as {
      content: string;
      tags: string[];
      metadata: Record<string, unknown> | null;
      type: string;
      scope: string | null;
      expiresAt: string | null;
      version: number;
    };
    expect(before.content).toBe('misc note');
    expect(before.tags).toEqual(['integration', 'lifecycle']);
    expect(before.metadata).toEqual({ origin: 'g3t3-test' });
    expect(before.type).toBe('long-term');
    expect(before.scope).toBe('project:lifecycle-test');
    expect(before.version).toBe(1);

    // Round trip: rebuild the memory from the snapshot exactly the way the
    // restore_memory tool does — original id preserved, content/tags intact.
    const restored = await service.restore({
      id: MEMORY_ID,
      userId: USER_ID,
      content: before.content,
      tags: before.tags,
      metadata: before.metadata,
      scope: before.scope ?? (audit!.scope as string | null),
      organizationId: audit!.organizationId as string | null,
    });
    expect(restored.id).toBe(MEMORY_ID);
    expect(restored.content).toBe('misc note');
    expect(restored.scope).toBe('project:lifecycle-test');

    const row = await prisma.memory.findUnique({ where: { id: MEMORY_ID } });
    expect(row).toMatchObject({ userId: USER_ID, content: 'misc note', version: 1 });
  });

  it('recordAccess leaves version UNCHANGED through a version-keyed update where (real Prisma)', async () => {
    // The restored row from the previous test sits at version 1. A get() fires
    // the (fire-and-forget) access bookkeeping, which must go through the
    // version-KEYED update `where` (proving Prisma accepts the non-unique
    // `version` field there) but must NOT bump `version`: get()/recall record
    // access, so a bump would invalidate the version the caller just read and
    // 409 its own follow-up update (update_memory requires expectedVersion,
    // G4-T2).
    const fetched = await service.get(USER_ID, MEMORY_ID);
    expect(fetched?.version).toBe(1);

    // recordAccess is fired with `void` — poll briefly for the bookkeeping.
    let row: Record<string, unknown> | null = null;
    for (let i = 0; i < 40; i += 1) {
      row = await prisma.memory.findUnique({ where: { id: MEMORY_ID } });
      const metadata = (row as { metadata?: { accessCount?: number } } | null)?.metadata;
      if (metadata?.accessCount === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const metadata = (
      row as {
        metadata: { accessCount?: number; lastAccessedAt?: string };
      }
    ).metadata;
    // The bookkeeping landed (accessCount + lastAccessedAt moved)...
    expect(metadata.accessCount).toBe(1);
    expect(typeof metadata.lastAccessedAt).toBe('string');
    expect(Number.isNaN(Date.parse(metadata.lastAccessedAt as string))).toBe(false);
    // ...while the version is UNCHANGED.
    expect(row).toMatchObject({ version: 1 });
  });

  it('read-then-update with the read version does not self-409 after access bookkeeping', async () => {
    // Regression pin (G3-T3 × G4-T2): the previous test's get() recorded an
    // access on the row read at version 1. An update carrying that same
    // version as expectedVersion must still succeed — the access write must
    // not have consumed the client's CAS token.
    const updated = await service.update(USER_ID, MEMORY_ID, {
      content: 'misc note (edited after read)',
      expectedVersion: 1,
    });
    expect(updated.version).toBe(2);
    expect(updated.content).toBe('misc note (edited after read)');

    const row = await prisma.memory.findUnique({ where: { id: MEMORY_ID } });
    expect(row).toMatchObject({ version: 2, content: 'misc note (edited after read)' });
  });
});
