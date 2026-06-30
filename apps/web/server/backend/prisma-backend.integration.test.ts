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
