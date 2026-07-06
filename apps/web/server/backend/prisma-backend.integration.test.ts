import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaEngramBackend } from './prisma-backend';

/**
 * Integration tests that exercise the hand-written raw SQL (unnest(tags),
 * array_length(embedding,1), date_trunc/to_char, Prisma.join) against a real
 * Postgres. Skipped automatically when DATABASE_URL is absent or unreachable,
 * mirroring the repo's other Prisma integration specs.
 *
 * Run with: DATABASE_URL=postgresql://... pnpm --filter web test
 */
const TEST_USER = '__dashboard_integration_test__';

let prisma: PrismaClient | null = null;
let available = false;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) return; // No DB configured → skip (CI without Postgres).

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await client.$queryRaw`SELECT 1`;
  } catch {
    // DB unreachable → skip rather than fail the whole suite.
    await client.$disconnect().catch(() => undefined);
    return;
  }

  // Reachable: from here on, errors (e.g. a stale schema) propagate and fail
  // loudly — a silently-skipped integration test is worse than none.
  prisma = client;
  available = true;
  await prisma.memory.deleteMany({ where: { userId: TEST_USER } });
  // memories.userId is a FK to users.id, so the owner must exist first.
  await prisma.user.upsert({
    where: { id: TEST_USER },
    create: { id: TEST_USER, email: `${TEST_USER}@test.local` },
    update: {},
  });
  await prisma.memory.createMany({
    data: [
      {
        userId: TEST_USER,
        content: 'integration memory with embedding',
        type: 'long-term',
        scope: 'project:integration',
        tags: ['insight', 'integration', 'alpha'],
        embedding: [0.1, 0.2, 0.3],
        createdAt: new Date('2026-06-20T10:00:00.000Z'),
      },
      {
        userId: TEST_USER,
        content: 'integration memory without embedding',
        type: 'long-term',
        tags: ['integration', 'beta'],
        embedding: [],
        createdAt: new Date('2026-06-21T10:00:00.000Z'),
      },
    ],
  });
});

afterAll(async () => {
  if (prisma) {
    // Deleting the user cascades to its memories.
    await prisma.user.deleteMany({ where: { id: TEST_USER } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});

describe('PrismaEngramBackend (real Postgres)', () => {
  function backend() {
    return new PrismaEngramBackend({ prisma: prisma!, mcpUrl: null, mcpApiKey: null });
  }

  it('lists memories with filters and an accurate embedding flag', async () => {
    if (!available) return;
    const result = await backend().listMemories({ userId: TEST_USER, limit: 10 });
    expect(result.totalCount).toBe(2);
    const withEmbedding = result.items.find((m) => m.content.includes('with embedding'));
    const without = result.items.find((m) => m.content.includes('without embedding'));
    expect(withEmbedding?.hasEmbedding).toBe(true);
    expect(without?.hasEmbedding).toBe(false);
    expect(withEmbedding?.isInsight).toBe(true);
    expect(withEmbedding?.scope).toBe('project:integration');
  });

  it('fetches a single memory by id', async () => {
    if (!available) return;
    const list = await backend().listMemories({ userId: TEST_USER, limit: 10 });
    const target = list.items[0]!;
    const fetched = await backend().getMemory(TEST_USER, target.id);
    expect(fetched?.id).toBe(target.id);
    expect(await backend().getMemory(TEST_USER, 'does-not-exist')).toBeNull();
  });

  it('filters by tag via hasEvery and by insightsOnly', async () => {
    if (!available) return;
    const alpha = await backend().listMemories({ userId: TEST_USER, tags: ['alpha'], limit: 10 });
    expect(alpha.totalCount).toBe(1);
    const insights = await backend().listMemories({
      userId: TEST_USER,
      insightsOnly: true,
      limit: 10,
    });
    expect(insights.totalCount).toBe(1);
  });

  it('computes stats with tag unnest, scope groups, and embedding counts', async () => {
    if (!available) return;
    const stats = await backend().getMemoryStats(TEST_USER);
    expect(stats.total).toBe(2);
    expect(stats.withEmbedding).toBe(1);
    expect(stats.withoutEmbedding).toBe(1);
    expect(stats.insightCount).toBe(1);
    const integrationTag = stats.topTags.find((t) => t.tag === 'integration');
    expect(integrationTag?.count).toBe(2);
    expect(stats.byType.find((t) => t.type === 'long-term')?.count).toBe(2);
  });

  it('builds a daily activity series (date_trunc/to_char)', async () => {
    if (!available) return;
    const series = await backend().getActivitySeries(TEST_USER, 3650);
    const total = series.reduce((acc, p) => acc + p.count, 0);
    expect(total).toBe(2);
    expect(series.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date))).toBe(true);
  });

  it('lists the test user among memory owners', async () => {
    if (!available) return;
    const owners = await backend().listMemoryOwners(200);
    const me = owners.find((o) => o.userId === TEST_USER);
    expect(me?.count).toBe(2);
    expect(me?.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// WP2 T1/D8: keyset pagination must not skip or duplicate rows under concurrent
// inserts/deletes, including when many rows share a createdAt (the id tiebreak).
const KEYSET_USER = '__dashboard_keyset_test__';
const KEYSET_TOTAL = 60;

describe('PrismaEngramBackend keyset pagination (real Postgres)', () => {
  function backend() {
    return new PrismaEngramBackend({ prisma: prisma!, mcpUrl: null, mcpApiKey: null });
  }

  beforeAll(async () => {
    if (!available || !prisma) return;
    await prisma.memory.deleteMany({ where: { userId: KEYSET_USER } });
    await prisma.user.upsert({
      where: { id: KEYSET_USER },
      create: { id: KEYSET_USER, email: `${KEYSET_USER}@test.local` },
      update: {},
    });
    // 60 rows across only 12 distinct timestamps → 5 rows per createdAt, so the
    // (createdAt, id) tiebreak is exercised heavily.
    await prisma.memory.createMany({
      data: Array.from({ length: KEYSET_TOTAL }, (_, i) => ({
        userId: KEYSET_USER,
        content: `keyset row ${i}`,
        type: 'long-term' as const,
        tags: [],
        embedding: [],
        createdAt: new Date(2026, 5, 1 + (i % 12), 0, 0, 0),
      })),
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.memory.deleteMany({ where: { userId: KEYSET_USER } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: KEYSET_USER } }).catch(() => undefined);
    }
  });

  async function walkAll(
    sortOrder: 'asc' | 'desc',
    pageSize: number,
    onPage?: (seen: string[]) => Promise<void>
  ): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null | undefined;
    // Generous safety bound so a pagination bug loops finitely, not forever.
    for (let page = 0; page < 200; page++) {
      const result = await backend().listMemories({
        userId: KEYSET_USER,
        limit: pageSize,
        sortBy: 'createdAt',
        sortOrder,
        cursor,
      });
      ids.push(...result.items.map((m) => m.id));
      if (onPage) await onPage(ids);
      if (!result.hasMore || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return ids;
  }

  it('walks every row exactly once, descending, with a small page size', async () => {
    if (!available) return;
    const ids = await walkAll('desc', 7);
    expect(ids).toHaveLength(KEYSET_TOTAL);
    expect(new Set(ids).size).toBe(KEYSET_TOTAL); // no duplicates
  });

  it('walks every row exactly once, ascending', async () => {
    if (!available) return;
    const ids = await walkAll('asc', 9);
    expect(ids).toHaveLength(KEYSET_TOTAL);
    expect(new Set(ids).size).toBe(KEYSET_TOTAL);
  });

  it('never skips or duplicates surviving rows when a row is deleted mid-walk', async () => {
    if (!available || !prisma) return;
    let deletedId: string | null = null;
    const ids = await walkAll('desc', 7, async (seen) => {
      // After the first page, delete a not-yet-seen row. Offset pagination would
      // shift every later row forward by one and skip a survivor; keyset does not.
      if (deletedId === null && seen.length >= 7) {
        const victim = await prisma!.memory.findFirst({
          where: { userId: KEYSET_USER, id: { notIn: seen } },
          select: { id: true },
        });
        if (victim) {
          deletedId = victim.id;
          await prisma!.memory.delete({ where: { id: victim.id } });
        }
      }
    });
    expect(deletedId).not.toBeNull();
    // No duplicates, and the deleted row is the only one that may be missing.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(deletedId);
    expect(ids.length).toBeGreaterThanOrEqual(KEYSET_TOTAL - 1);
  });
});
