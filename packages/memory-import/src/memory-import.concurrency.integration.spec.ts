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
 * G4-T3 acceptance (CAS-skip, DB-gated). Proves against a real migrated
 * Postgres — real `MemoryLtmService` version CAS + real import ledger — that:
 *  - a first import records `lastWrittenVersion` in `memory_import_sources`;
 *  - an out-of-band ENGRAM edit (service-level `update()`, as an agent would)
 *    bumps `Memory.version` past the ledger's snapshot;
 *  - re-importing the (changed) source then SKIPS: the memory keeps the
 *    agent's content, the summary counts `skippedConcurrentEdit`, and the
 *    ledger row (hash + version) is left untouched so the next run re-reports.
 *
 * Gate: set `MEMORY_IMPORT_CAS_TEST_URL` (or reuse `PGVECTOR_TEST_URL`) to any
 * migrated Postgres. Skipped otherwise. Run locally with:
 *   MEMORY_IMPORT_CAS_TEST_URL=postgresql://engram:...@localhost:5432/engram \
 *     pnpm --filter @engram/memory-import test
 */
const connectionString = process.env.MEMORY_IMPORT_CAS_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

// CUID1-shaped so it passes the LTM service's userId validation.
const USER_ID = 'clg4t3casskip00000000001';
const SOURCE_KEY = 'markdown:g4t3-cas.md';
// Ledger rows are keyed by the root-namespaced form of the adapter key (#236).
const LEDGER_KEY = namespaceSourceKey(SOURCE_KEY, '/vault');

function makeIR(content: string): ImportIR {
  return {
    sourceTool: 'markdown',
    rootPath: '/vault',
    facts: [
      {
        localId: SOURCE_KEY,
        sourceTool: 'markdown',
        sourcePath: 'g4t3-cas.md',
        sourceKey: SOURCE_KEY,
        content,
        tags: ['markdown'],
        links: [],
      },
    ],
    provenance: {
      importedAt: new Date().toISOString(),
      importBatchId: 'g4t3-batch',
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

describePg('G4-T3 import-vs-agent-edit CAS-skip (integration)', () => {
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
    // Prisma v7 uses a WASM client engine that requires a driver adapter.
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "email", "updatedAt")
       VALUES ($1, $2, now())
       ON CONFLICT ("id") DO NOTHING`,
      USER_ID,
      'g4t3-cas-skip@test.local'
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
    'keeps the agent edit and counts skippedConcurrentEdit on re-import',
    { timeout: 30_000 },
    async () => {
      // Run 1: first import → creates the memory, ledger records version 1.
      const run1 = await buildImporter(ltm, ledger, makeIR('Fact v1 from source')).run({
        source: 'markdown',
        path: '/vault',
        userId: USER_ID,
      });
      expect(run1.created).toBe(1);
      expect(run1.skippedConcurrentEdit).toBe(0);

      const entry1 = await ledger.find(USER_ID, LEDGER_KEY);
      expect(entry1).not.toBeNull();
      expect(entry1!.lastWrittenVersion).toBe(1);
      const memoryId = entry1!.memoryId;

      // Out-of-band agent edit (service-level update, no expectedVersion —
      // exactly what an agent write through the server does): version 1 → 2.
      await ltm.update(USER_ID, memoryId, { content: 'Agent-improved fact' });

      // Run 2: the source changed too → drift update → CAS miss → skip.
      const run2 = await buildImporter(ltm, ledger, makeIR('Fact v2 from source')).run({
        source: 'markdown',
        path: '/vault',
        userId: USER_ID,
      });
      expect(run2.skippedConcurrentEdit).toBe(1);
      expect(run2.updated).toBe(0);
      expect(run2.failed).toBe(0);

      // The memory keeps the agent's content — the source never clobbers it.
      const memory = await ltm.get(USER_ID, memoryId);
      expect(memory?.content).toBe('Agent-improved fact');

      // Ledger row untouched: stale hash + version → the next run re-reports.
      const entry2 = await ledger.find(USER_ID, LEDGER_KEY);
      expect(entry2!.contentHash).toBe(computeContentHash('Fact v1 from source'));
      expect(entry2!.lastWrittenVersion).toBe(1);
    }
  );
});
