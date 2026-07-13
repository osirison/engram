import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryLtmService } from '@engram/memory-ltm';
import { MemoryImportService } from './memory-import.service.js';
import { ImportLedgerService } from './ledger/import-ledger.service.js';
import { namespaceSourceKey } from './ledger/source-key.js';
import { SecretScanner } from './secrets/secret-scanner.js';
import { computeContentHash } from './content-hash.js';
import type { ImportIR } from './ir/types.js';
import type { SourceAdapter } from './ir/source-adapter.interface.js';

/**
 * #236 acceptance (multi-root ledger namespacing, DB-gated). Proves against a
 * real migrated Postgres — real unique constraint, real ledger — that:
 *  - two import roots sharing a relative path (two repos each with the same
 *    file) get DISTINCT ledger rows and memories (no collision);
 *  - alternating unchanged re-imports of both roots are pure skips (no thrash:
 *    previously each root re-"updated" the shared row with its own content);
 *  - a pre-namespacing ledger row (bare `<tool>:<relpath>` key) is migrated in
 *    place on first re-import — same memoryId, no duplicate memory, and the
 *    `(userId, sourceKey)` uniqueness stays intact.
 *
 * Gate: set `MEMORY_IMPORT_CAS_TEST_URL` (or reuse `PGVECTOR_TEST_URL`) to any
 * migrated Postgres. Skipped otherwise. Run locally with:
 *   MEMORY_IMPORT_CAS_TEST_URL=postgresql://engram:...@localhost:5432/engram \
 *     pnpm --filter @engram/memory-import test
 */
const connectionString = process.env.MEMORY_IMPORT_CAS_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

// CUID1-shaped so it passes the LTM service's userId validation.
const USER_ID = 'cl236multiroot0000000001';
const BARE_KEY = 'markdown:CLAUDE-236.md';
const ROOT_A = '/repo-236-a';
const ROOT_B = '/repo-236-b';

function makeIR(rootPath: string, content: string, sourcePath = 'CLAUDE-236.md'): ImportIR {
  return {
    sourceTool: 'markdown',
    rootPath,
    facts: [
      {
        localId: `markdown:${sourcePath}`,
        sourceTool: 'markdown',
        sourcePath,
        sourceKey: `markdown:${sourcePath}`,
        content,
        tags: ['markdown'],
        links: [],
      },
    ],
    provenance: {
      importedAt: new Date().toISOString(),
      importBatchId: 'i236-batch',
      adapterVersion: '1',
    },
  };
}

function buildImporter(
  ltm: MemoryLtmService,
  ledger: ImportLedgerService,
  ir: ImportIR
): MemoryImportService {
  const adapter: SourceAdapter = {
    tool: 'markdown',
    detect: async () => true,
    parse: async () => ir,
  };
  const registry = new Map([['markdown', adapter]]);
  const resolver = {
    resolveBatch: async () => ({ resolved: 0, deferred: 0, total: 0 }),
    resolveDeferred: async () => 0,
  };
  return new MemoryImportService(
    ltm,
    ledger,
    resolver as never,
    new SecretScanner(),
    registry as never
  );
}

describePg('#236 multi-root ledger namespacing (integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let ltm: MemoryLtmService;
  let ledger: ImportLedgerService;

  async function cleanup(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "memory_import_sources" WHERE "userId" = $1`,
      USER_ID
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "memories" WHERE "userId" = $1`, USER_ID);
  }

  beforeAll(async () => {
    const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
      import('@prisma/client'),
      import('@prisma/adapter-pg'),
    ]);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "email", "updatedAt")
       VALUES ($1, $2, now())
       ON CONFLICT ("id") DO NOTHING`,
      USER_ID,
      'i236-multiroot@test.local'
    );
    await cleanup();
    ltm = new MemoryLtmService(prisma as never);
    ledger = new ImportLedgerService(prisma as never);
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1`, USER_ID);
    await prisma.$disconnect();
  });

  it(
    'two roots with the same relpath → distinct rows, no thrash on alternating re-imports',
    { timeout: 30_000 },
    async () => {
      const contentA = 'Rules for repo A (#236)';
      const contentB = 'Rules for repo B (#236)';

      // First import of each root.
      const runA1 = await buildImporter(ltm, ledger, makeIR(ROOT_A, contentA)).run({
        source: 'markdown',
        path: ROOT_A,
        userId: USER_ID,
      });
      const runB1 = await buildImporter(ltm, ledger, makeIR(ROOT_B, contentB)).run({
        source: 'markdown',
        path: ROOT_B,
        userId: USER_ID,
      });
      expect(runA1.created).toBe(1);
      expect(runB1.created).toBe(1);

      // Distinct ledger rows under distinct namespaced keys, distinct memories.
      const keyA = namespaceSourceKey(BARE_KEY, ROOT_A);
      const keyB = namespaceSourceKey(BARE_KEY, ROOT_B);
      expect(keyA).not.toBe(keyB);
      const rowA = await ledger.find(USER_ID, keyA);
      const rowB = await ledger.find(USER_ID, keyB);
      expect(rowA).not.toBeNull();
      expect(rowB).not.toBeNull();
      expect(rowA!.memoryId).not.toBe(rowB!.memoryId);

      // Alternating unchanged re-imports: pure idempotent skips, content stable.
      const runA2 = await buildImporter(ltm, ledger, makeIR(ROOT_A, contentA)).run({
        source: 'markdown',
        path: ROOT_A,
        userId: USER_ID,
      });
      const runB2 = await buildImporter(ltm, ledger, makeIR(ROOT_B, contentB)).run({
        source: 'markdown',
        path: ROOT_B,
        userId: USER_ID,
      });
      expect(runA2.skipped).toBe(1);
      expect(runA2.updated).toBe(0);
      expect(runB2.skipped).toBe(1);
      expect(runB2.updated).toBe(0);
      expect((await ltm.get(USER_ID, rowA!.memoryId))?.content).toBe(contentA);
      expect((await ltm.get(USER_ID, rowB!.memoryId))?.content).toBe(contentB);
    }
  );

  it(
    'legacy bare-key row migrates in place: same memory, idempotent, no duplicate',
    { timeout: 30_000 },
    async () => {
      const content = 'Legacy fact (#236 upgrade path)';
      const bareKey = 'markdown:legacy-236.md';

      // Seed a PRE-NAMESPACING state: memory + ledger row under the bare key,
      // exactly what a WP4-era import would have written.
      const memory = await ltm.create({
        userId: USER_ID,
        scope: 'import',
        content,
        tags: ['markdown'],
      });
      await ledger.upsert({
        userId: USER_ID,
        memoryId: memory.id,
        sourceTool: 'markdown',
        sourcePath: 'legacy-236.md',
        sourceKey: bareKey,
        contentHash: computeContentHash(content),
        importBatchId: 'legacy-batch',
        lastWrittenVersion: memory.version,
      });

      // Re-import (unchanged content) with the namespaced pipeline.
      const run = await buildImporter(ltm, ledger, makeIR(ROOT_A, content, 'legacy-236.md')).run({
        source: 'markdown',
        path: ROOT_A,
        userId: USER_ID,
      });
      expect(run.skipped).toBe(1);
      expect(run.created).toBe(0);
      expect(run.updated).toBe(0);

      // Renamed in place: bare key gone, namespaced key keeps the SAME memory.
      const nsKey = namespaceSourceKey(bareKey, ROOT_A);
      expect(await ledger.find(USER_ID, bareKey)).toBeNull();
      const migrated = await ledger.find(USER_ID, nsKey);
      expect(migrated).not.toBeNull();
      expect(migrated!.memoryId).toBe(memory.id);
      expect(migrated!.lastWrittenVersion).toBe(memory.version);

      // No duplicate memory was created for this content.
      const count: Array<{ count: bigint }> = await prisma.$queryRawUnsafe(
        `SELECT count(*)::bigint AS count FROM "memories" WHERE "userId" = $1 AND "content" = $2`,
        USER_ID,
        content
      );
      expect(Number(count[0]!.count)).toBe(1);

      // Second re-import: plain ledger hit on the namespaced key (idempotent).
      const rerun = await buildImporter(ltm, ledger, makeIR(ROOT_A, content, 'legacy-236.md')).run({
        source: 'markdown',
        path: ROOT_A,
        userId: USER_ID,
      });
      expect(rerun.skipped).toBe(1);
      expect(rerun.created).toBe(0);
    }
  );
});
