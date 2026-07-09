/**
 * Export → import round-trip contract (G6) — DB side.
 *
 * Proves the cross-WP guarantee end-to-end against real Postgres: a set of
 * memories exported by WP3 (`MemoryExportService` → `DirectorySink`) and
 * re-imported into a CLEAN tenant by WP4 (`MemoryImportService`, markdown
 * adapter) reproduces each memory's **durable projection** — content, tags,
 * type, scope, and durable link topology — even though the DB mints new ids
 * on re-import. The `MemoryLink @@unique(sourceMemoryId, targetLocator,
 * relType)` constraint (SHARED-1) makes a second import idempotent.
 *
 * Design pins (see PLAN §4.10 + the parse-side proof in
 * `packages/memory-interchange/src/roundtrip.spec.ts`):
 *  - Compare `durableProjection` SETS keyed by content, IGNORING the volatile
 *    DB id (re-import mints new cuids) and derived edges / volatile fields.
 *  - Durable edges are seeded as METADATA edges (an insight's `sourceMemoryIds`
 *    → `derived-from`/`source-of`, origin `durable`) because the export read
 *    path's `loadMemoryLinks` seam still returns undefined (SHARED-1 not enabled
 *    on export). A NON-VACUITY guard asserts at least one durable edge actually
 *    survives, so a wiring regression cannot let the test pass with zero links.
 *  - `id:<originalId>` frontmatter links dangle after a clean re-import (the new
 *    tenant has none of the original ids), so the link's `targetLocator` retains
 *    the original id string — which is exactly what makes the (rel, target)
 *    topology comparable across the round-trip.
 *
 * Infra (mirrors memory-system.e2e-spec.ts):
 *   docker compose -f docker-compose.test.yml up -d --wait
 *   DATABASE_URL=postgresql://engram_test:test_password@localhost:5433/engram_test \
 *     pnpm -w db:migrate:deploy
 *   E2E_ENABLED=true DATABASE_URL=… REDIS_URL=… QDRANT_URL=… NODE_ENV=test \
 *     pnpm --filter mcp-server test:e2e
 */

// Set required env before NestJS bootstraps (must precede any config-validating import).
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://engram_test:test_password@localhost:5433/engram_test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
process.env.QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6335';
// Deterministic local hash provider — no OpenAI key needed. Import runs with
// embed:false regardless, but this keeps the whole app self-contained.
process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'local';

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@engram/database';
import { MemoryLtmService } from '@engram/memory-ltm';
import { MemoryImportService } from '@engram/memory-import';
import {
  durableProjection,
  durableProjectionOfDocument,
  parseDocument,
  type DurableProjection,
  type MemoryEdge,
} from '@engram/memory-interchange';
import { AppModule } from '../src/app.module';
import { MemoryExportService } from '../src/memory/export/memory-export.service';
import { DirectorySink } from '../src/memory/export/directory-sink';

const E2E_ENABLED = process.env.E2E_ENABLED === 'true';
const suite: (name: string, fn: () => void) => void = E2E_ENABLED
  ? describe
  : describe.skip;

/** Strip a `<kind>:` locator prefix → the raw target string (e.g. the cuid). */
function locatorTarget(locator: string): string {
  const idx = locator.indexOf(':');
  return idx >= 0 ? locator.slice(idx + 1) : locator;
}

/** Read the exported per-memory docs (multi mode writes them under `memories/`). */
function readMemoryDocs(vaultDir: string): string[] {
  const dir = join(vaultDir, 'memories');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(join(dir, f), 'utf8'));
}

suite('export → import round-trip (G6) — DB side', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ltm: MemoryLtmService;
  let exportSvc: MemoryExportService;
  let importSvc: MemoryImportService;

  let srcUserId: string;
  let destUserId: string;
  let vaultDir: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.forRoot()],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    ltm = moduleFixture.get(MemoryLtmService);
    exportSvc = moduleFixture.get(MemoryExportService);
    importSvc = moduleFixture.get(MemoryImportService);

    // Two isolated tenants: export from src, import into a CLEAN dest.
    const stamp = Date.now();
    const src = await prisma.user.create({
      data: { email: `g6-src-${stamp}@e2e.local` },
    });
    srcUserId = src.id;
    const dest = await prisma.user.create({
      data: { email: `g6-dest-${stamp}@e2e.local` },
    });
    destUserId = dest.id;

    // Seed a source memory + an insight derived from it. The insight's
    // isInsight + sourceMemoryIds metadata is what the edge collector turns into
    // a DURABLE derived-from (and its inverse source-of on the source memory).
    const source = await ltm.create({
      userId: srcUserId,
      content:
        'G6 source fact: always rebase a worktree onto origin/main first.',
      tags: ['decision'],
      skipDuplicateCheck: true,
    });
    const insight = await ltm.create({
      userId: srcUserId,
      content:
        'G6 insight: worktree hygiene reduces cross-agent merge conflicts.',
      tags: ['insight'],
      skipDuplicateCheck: true,
    });
    // Set the insight metadata directly so the durable edge is deterministic and
    // unaffected by the create pipeline (importance annotation etc.).
    await prisma.memory.update({
      where: { id: insight.id },
      data: {
        metadata: {
          isInsight: true,
          sourceMemoryIds: [source.id],
          topic: 'g6-worktrees',
        },
      },
    });

    // Export the source tenant's vault to a temp directory (deterministic).
    vaultDir = mkdtempSync(join(tmpdir(), 'g6-vault-'));
    await exportSvc.export(
      { userId: srcUserId, deterministic: true, mode: 'multi' },
      new DirectorySink(vaultDir),
    );
  });

  afterAll(async () => {
    // Deleting the users cascades to their memories + memory_links.
    if (prisma && srcUserId) {
      await prisma.user.delete({ where: { id: srcUserId } }).catch(() => {});
    }
    if (prisma && destUserId) {
      await prisma.user.delete({ where: { id: destUserId } }).catch(() => {});
    }
    if (vaultDir) rmSync(vaultDir, { recursive: true, force: true });
    if (app) await app.close();
  });

  it('exports at least one durable edge into the vault (non-vacuity guard)', () => {
    const durableCount = readMemoryDocs(vaultDir)
      .map((c) => durableProjectionOfDocument(parseDocument(c)))
      .reduce((n, p) => n + p.durableLinks.length, 0);
    // derived-from (on the insight) + source-of (on the source) ⇒ ≥ 2.
    expect(durableCount).toBeGreaterThanOrEqual(2);
  });

  it('reproduces the durable projection of every exported memory after a clean re-import', async () => {
    await importSvc.run({
      source: 'markdown',
      path: vaultDir,
      userId: destUserId,
      embed: false,
    });
    expect(
      await prisma.memory.count({ where: { userId: destUserId } }),
    ).toBeGreaterThan(0);

    // Expected: durable projections of the exported docs (original ids).
    const expected = new Map<string, DurableProjection>();
    for (const doc of readMemoryDocs(vaultDir)) {
      const p = durableProjectionOfDocument(parseDocument(doc));
      expected.set(p.content, p);
    }

    // Actual: rebuild durable projections from the re-imported rows + their
    // MemoryLink edges (origin authored ⇒ durable; the locator keeps the
    // original target id, which never remaps because it dangles).
    const reimported = await reimportedByContent(prisma, destUserId);

    // exported ⊆ reimported: every exported memory round-trips faithfully. (The
    // vault's index.md may re-import as an extra memory; it is not an expected
    // key, so it is ignored — we assert exported memories survive, not the
    // absence of extras.)
    //
    // Strict round-trip invariants: content, type, and durable-link topology
    // (rel/target/origin). Import DELIBERATELY re-scopes into its own namespace
    // and adds a provenance source tag, so scope is not required to match and the
    // original tags are asserted as a SUBSET (import adds, never drops).
    let totalDurable = 0;
    for (const [content, ep] of expected) {
      const rp = reimported.get(content);
      expect(rp).toBeDefined();
      expect(rp!.content).toBe(ep.content);
      expect(rp!.type).toBe(ep.type);
      expect(rp!.durableLinks).toEqual(ep.durableLinks);
      for (const tag of ep.tags) expect(rp!.tags).toContain(tag);
      totalDurable += ep.durableLinks.length;
    }
    // Non-vacuity: the durable edges genuinely survived the DB round-trip.
    expect(totalDurable).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent: a second import adds no memories or links (SHARED-1 unique key)', async () => {
    const memBefore = await prisma.memory.count({
      where: { userId: destUserId },
    });
    const linkBefore = await prisma.memoryLink.count({
      where: { userId: destUserId },
    });
    await importSvc.run({
      source: 'markdown',
      path: vaultDir,
      userId: destUserId,
      embed: false,
    });
    expect(await prisma.memory.count({ where: { userId: destUserId } })).toBe(
      memBefore,
    );
    expect(
      await prisma.memoryLink.count({ where: { userId: destUserId } }),
    ).toBe(linkBefore);
  });
});

/** Build content-keyed durable projections from a tenant's re-imported rows. */
async function reimportedByContent(
  prisma: PrismaService,
  userId: string,
): Promise<Map<string, DurableProjection>> {
  const memories = await prisma.memory.findMany({
    where: { userId },
    select: { id: true, type: true, scope: true, tags: true, content: true },
  });
  const out = new Map<string, DurableProjection>();
  for (const mem of memories) {
    const links = await prisma.memoryLink.findMany({
      where: { userId, sourceMemoryId: mem.id },
      select: { relType: true, targetLocator: true, origin: true },
    });
    const edges: MemoryEdge[] = links.map((l) => ({
      rel: l.relType as MemoryEdge['rel'],
      target: locatorTarget(l.targetLocator),
      origin: l.origin === 'derived' ? 'derived' : 'durable',
    }));
    const p = durableProjection({
      id: mem.id,
      type: mem.type as DurableProjection['type'],
      scope: mem.scope,
      tags: mem.tags,
      content: mem.content,
      links: edges,
    });
    out.set(p.content, p);
  }
  return out;
}
