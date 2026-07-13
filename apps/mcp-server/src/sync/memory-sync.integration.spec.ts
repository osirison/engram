/**
 * WP5 T11 / #240 — live file-watcher sync integration test (DB-gated).
 *
 * Drives the REAL stack end-to-end against a migrated Postgres: a temp dir
 * with a CLAUDE.md, the real claude-code adapter, the WP4 importer
 * (`MemoryImportService` + `ImportLedgerService` + `LinkResolver` +
 * `SecretScanner`), the real `MemoryLtmService`, and the WP5
 * `MemorySyncService` on top. Covers:
 *  - first sync imports (`touch → single upsert`);
 *  - unchanged re-sync is a ledger-hit no-op (no dup);
 *  - a changed file updates the SAME memory in place (single ledger row);
 *  - D7 conflict (#239): the file version is stored as a `conflict`-tagged
 *    copy, the contested memory is untouched, re-runs are idempotent, a
 *    further file edit refreshes the one copy (no pile-up), and reconciling
 *    (accept the file version in ENGRAM, then force-sync) clears the conflict
 *    and removes the stale copy.
 *
 * The debounce/watch loop itself stays unit-tested (debounce.spec.ts); this
 * test exercises what a debounced watcher invocation executes.
 *
 * Gate: set `MEMORY_SYNC_TEST_URL` (or reuse `MEMORY_IMPORT_CAS_TEST_URL` /
 * `PGVECTOR_TEST_URL`) to any migrated Postgres. Skipped otherwise. Uses a
 * dedicated throwaway userId with full cleanup — never a real user's data.
 * Run locally with:
 *   MEMORY_SYNC_TEST_URL=postgresql://... pnpm --filter mcp-server test -- memory-sync.integration
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { MemoryLtmService } from '@engram/memory-ltm';
import {
  ImportLedgerService,
  LinkResolver,
  MemoryImportService,
  SecretScanner,
  buildAdapterRegistry,
} from '@engram/memory-import';

import {
  CONFLICT_COPY_SCOPE,
  CONFLICT_COPY_TAG,
  MemorySyncService,
  type SyncSpec,
} from './memory-sync.service';

const connectionString =
  process.env.MEMORY_SYNC_TEST_URL ??
  process.env.MEMORY_IMPORT_CAS_TEST_URL ??
  process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

// CUID1-shaped so it passes the LTM service's userId validation.
const USER_ID = 'clwp5synclive00000000001';
const SCOPE = 'import';

/** CLAUDE.md with one H2 section → exactly one imported fact. */
function claudeMd(sectionBody: string): string {
  return `## Conventions\n\n${sectionBody}\n`;
}

describePg('#240 live file-watcher sync (integration)', () => {
  let prisma: PrismaClient;
  let ltm: MemoryLtmService;
  let ledger: ImportLedgerService;
  let importService: MemoryImportService;
  let sync: MemorySyncService;
  let root: string;
  let spec: SyncSpec;

  async function cleanup(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "memory_import_sources" WHERE "userId" = $1`,
      USER_ID,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "memory_links" WHERE "userId" = $1`,
      USER_ID,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "memories" WHERE "userId" = $1`,
      USER_ID,
    );
  }

  async function memoryCount(): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "memories" WHERE "userId" = $1`,
      USER_ID,
    );
    return Number(rows[0]!.count);
  }

  async function conflictCopies(): Promise<
    Array<{ id: string; content: string; metadata: unknown }>
  > {
    return prisma.memory.findMany({
      where: {
        userId: USER_ID,
        scope: CONFLICT_COPY_SCOPE,
        tags: { has: CONFLICT_COPY_TAG },
      },
      select: { id: true, content: true, metadata: true },
    });
  }

  /** The single fact the current CLAUDE.md parses to (sanitized content + keys). */
  async function currentFact() {
    const facts = await importService.parseFacts({
      source: 'claude-code',
      path: root,
    });
    expect(facts).toHaveLength(1);
    return facts[0]!;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString! }),
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "email", "updatedAt")
       VALUES ($1, $2, now())
       ON CONFLICT ("id") DO NOTHING`,
      USER_ID,
      'wp5-sync-live@test.local',
    );
    await cleanup();

    ltm = new MemoryLtmService(prisma as never);
    ledger = new ImportLedgerService(prisma as never);
    importService = new MemoryImportService(
      ltm,
      ledger,
      new LinkResolver(prisma as never, ledger),
      new SecretScanner(),
      buildAdapterRegistry(),
    );
    sync = new MemorySyncService(importService, ledger, prisma as never, ltm);

    root = mkdtempSync(join(tmpdir(), 'engram-sync-240-'));
    spec = { source: 'claude-code', root, userId: USER_ID, scope: SCOPE };
  });

  afterAll(async () => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (!prisma) return;
    await cleanup();
    await prisma.$executeRawUnsafe(
      `DELETE FROM "users" WHERE "id" = $1`,
      USER_ID,
    );
    await prisma.$disconnect();
  });

  it('touch → single upsert → no dup; conflict copy lifecycle end-to-end', async () => {
    // ── 1. First sync imports the file ────────────────────────────────────
    writeFileSync(
      join(root, 'CLAUDE.md'),
      claudeMd('Use pnpm for everything (v1).'),
    );
    const run1 = await sync.syncSource(spec, { embed: false });
    expect(run1.skipped).toBe(false);
    expect(run1.summary!.created).toBe(1);
    expect(await memoryCount()).toBe(1);

    const entries = await ledger.listByUser(USER_ID);
    expect(entries).toHaveLength(1);
    const memoryId = entries[0]!.memoryId;
    // #236: the ledger key carries the root namespace.
    expect(entries[0]!.sourceKey).toMatch(
      /^claude-code@[0-9a-f]{12}:CLAUDE\.md/,
    );

    // ── 2. Unchanged re-sync (touch) is a no-op: ledger hit, no dup ───────
    writeFileSync(
      join(root, 'CLAUDE.md'),
      claudeMd('Use pnpm for everything (v1).'),
    );
    const run2 = await sync.syncSource(spec, { embed: false });
    expect(run2.skipped).toBe(false);
    expect(run2.summary!.skipped).toBe(1);
    expect(run2.summary!.created).toBe(0);
    expect(run2.summary!.updated).toBe(0);
    expect(await memoryCount()).toBe(1);

    // ── 3. Changed file updates the SAME memory in place ──────────────────
    writeFileSync(
      join(root, 'CLAUDE.md'),
      claudeMd('Use pnpm for everything (v2).'),
    );
    const run3 = await sync.syncSource(spec, { embed: false });
    expect(run3.summary!.updated).toBe(1);
    expect(run3.summary!.created).toBe(0);
    expect(await memoryCount()).toBe(1); // single row — no duplicate
    const afterUpdate = await ltm.get(USER_ID, memoryId);
    expect(afterUpdate!.content).toContain('(v2)');
    expect(await ledger.listByUser(USER_ID)).toHaveLength(1); // single ledger row

    // ── 4. D7 conflict (#239): agent edit + file edit → tagged copy ───────
    await ltm.update(USER_ID, memoryId, {
      content: 'Agent-improved conventions',
    });
    writeFileSync(join(root, 'CLAUDE.md'), claudeMd('File-side change (v3).'));
    const v3Fact = await currentFact();
    const run4 = await sync.syncSource(spec, { embed: false, skewMs: 0 });
    expect(run4.skipped).toBe(true);
    expect(run4.conflicts).toHaveLength(1);
    expect(run4.conflictCopies.created).toBe(1);

    let copies = await conflictCopies();
    expect(copies).toHaveLength(1);
    expect(copies[0]!.content).toBe(v3Fact.content); // file version preserved
    expect(
      (copies[0]!.metadata as { conflict: { memoryId: string } }).conflict
        .memoryId,
    ).toBe(memoryId); // linked to the contested memory
    // The contested memory is untouched — the agent edit survives.
    expect((await ltm.get(USER_ID, memoryId))!.content).toBe(
      'Agent-improved conventions',
    );

    // ── 5. Idempotent re-run: still exactly ONE copy ──────────────────────
    const run5 = await sync.syncSource(spec, { embed: false, skewMs: 0 });
    expect(run5.skipped).toBe(true);
    expect(run5.conflictCopies.created).toBe(0);
    expect(run5.conflictCopies.unchanged).toBe(1);
    expect(await conflictCopies()).toHaveLength(1);

    // ── 6. File moves on while conflicted: the one copy refreshes ─────────
    writeFileSync(join(root, 'CLAUDE.md'), claudeMd('File-side change (v4).'));
    const v4Fact = await currentFact();
    const run6 = await sync.syncSource(spec, { embed: false, skewMs: 0 });
    expect(run6.skipped).toBe(true);
    expect(run6.conflictCopies.updated).toBe(1);
    copies = await conflictCopies();
    expect(copies).toHaveLength(1); // no pile-up
    expect(copies[0]!.content).toBe(v4Fact.content);

    // ── 7. Reconcile: accept the file version in ENGRAM, then force-sync ──
    // The importer's convergence check refreshes the ledger (no clobber
    // needed), the D7 conflict clears, and the stale copy is removed.
    await ltm.update(USER_ID, memoryId, { content: v4Fact.content });
    const run7 = await sync.syncSource(spec, {
      embed: false,
      skewMs: 0,
      force: true,
    });
    expect(run7.skipped).toBe(false);
    expect(run7.summary!.reconciled).toBe(1);
    expect(run7.summary!.updated).toBe(0);
    expect(run7.conflictCopies.removedStale).toBe(1);
    expect(await conflictCopies()).toHaveLength(0); // no stale copies remain
    expect((await ltm.get(USER_ID, memoryId))!.content).toBe(v4Fact.content);

    // ── 8. Steady state: the next sync is a clean idempotent no-op ────────
    const run8 = await sync.syncSource(spec, { embed: false, skewMs: 0 });
    expect(run8.skipped).toBe(false);
    expect(run8.summary!.skipped).toBe(1);
    expect(run8.summary!.skippedConcurrentEdit).toBe(0);
    expect(await conflictCopies()).toHaveLength(0);
    expect(await memoryCount()).toBe(1);
  }, 120_000);
});
