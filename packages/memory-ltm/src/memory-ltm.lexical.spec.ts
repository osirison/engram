import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryLtmService } from './memory-ltm.service';
import { MemoryType } from '@engram/database';
import type { VectorStore } from '@engram/vector-store';

/**
 * Issue 288 — recall must not silently return `[]` when embeddings are off.
 *
 * Two halves are covered here:
 *  1. `semanticSearchDetailed` reports *why* it produced nothing, so a caller
 *     can tell "degraded" from "genuinely empty".
 *  2. `lexicalSearch` answers from Postgres with the same filters the semantic
 *     path applies — degrading retrieval quality must never widen what a
 *     caller is allowed to see.
 */

const mockUserId = 'cldx4k8xp000108l83h4y8v2q';

function buildMemory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cldx4k8xp000208l84b5c9w3r',
    userId: mockUserId,
    content: 'Use pnpm in this repo, never npm',
    scope: 'project-a',
    metadata: null,
    tags: ['tooling'],
    type: MemoryType.LONG_TERM,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: null,
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

describe('MemoryLtmService — degraded-mode retrieval (issue 288)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddings: any;
  let vectorStore: VectorStore & { search: ReturnType<typeof vi.fn> };

  function makePrisma() {
    return {
      memory: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
  }

  beforeEach(() => {
    prisma = makePrisma();
    embeddings = { generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }) };
    vectorStore = {
      backend: 'pgvector',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
    } as unknown as typeof vectorStore;
  });

  describe('semanticSearchDetailed — distinguishes degraded from empty', () => {
    it('reports no-vector-store when the store is absent', async () => {
      const service = new MemoryLtmService(prisma, undefined, embeddings, undefined);

      const result = await service.semanticSearchDetailed(mockUserId, 'anything');

      expect(result).toEqual({ results: [], degraded: true, reason: 'no-vector-store' });
    });

    it('reports no-embeddings-service when embeddings are absent', async () => {
      const service = new MemoryLtmService(prisma, undefined, undefined, vectorStore);

      const result = await service.semanticSearchDetailed(mockUserId, 'anything');

      expect(result).toEqual({
        results: [],
        degraded: true,
        reason: 'no-embeddings-service',
      });
    });

    it.each([
      ['the provider returns null (EMBEDDING_PROVIDER=disabled)', null],
      ['the provider returns an empty vector', { embedding: [] }],
    ])('reports no-query-embedding when %s', async (_label, generated) => {
      embeddings.generate.mockResolvedValue(generated);
      const service = new MemoryLtmService(prisma, undefined, embeddings, vectorStore);

      const result = await service.semanticSearchDetailed(mockUserId, 'anything');

      expect(result).toEqual({
        results: [],
        degraded: true,
        reason: 'no-query-embedding',
      });
    });

    it('reports no-query-embedding when the provider throws', async () => {
      embeddings.generate.mockRejectedValue(new Error('ollama unreachable'));
      const service = new MemoryLtmService(prisma, undefined, embeddings, vectorStore);

      const result = await service.semanticSearchDetailed(mockUserId, 'anything');

      expect(result.degraded).toBe(true);
      expect(result.reason).toBe('no-query-embedding');
    });

    it('is NOT degraded when a healthy search simply matches nothing', async () => {
      // The distinction the whole fix rests on. If this ever reports degraded,
      // every genuinely-empty query silently widens into a keyword scan.
      vectorStore.search.mockResolvedValue([]);
      const service = new MemoryLtmService(prisma, undefined, embeddings, vectorStore);

      const result = await service.semanticSearchDetailed(mockUserId, 'no match');

      expect(result).toEqual({ results: [], degraded: false });
    });

    it('is NOT degraded for an empty query — that is caller error, not a broken backend', async () => {
      const service = new MemoryLtmService(prisma, undefined, embeddings, vectorStore);

      const result = await service.semanticSearchDetailed(mockUserId, '   ');

      expect(result).toEqual({ results: [], degraded: false });
    });

    it('leaves semanticSearch() returning a plain array, so existing callers are unaffected', async () => {
      const service = new MemoryLtmService(prisma, undefined, embeddings, undefined);

      await expect(service.semanticSearch(mockUserId, 'anything')).resolves.toEqual([]);
    });
  });

  describe('lexicalSearch', () => {
    function service() {
      return new MemoryLtmService(prisma, undefined, embeddings, vectorStore);
    }

    it('returns matches ranked by term coverage, with a score in [0, 1]', async () => {
      // Terms chosen so neither is a substring of the other: matching is
      // ILIKE %term%, so "npm" would match inside "pnpm" and both rows would
      // tie at full coverage.
      prisma.memory.findMany.mockResolvedValue([
        buildMemory({ id: 'both', content: 'Use pnpm with docker locally' }),
        buildMemory({ id: 'one', content: 'pnpm is fine' }),
      ]);

      const results = await service().lexicalSearch(mockUserId, 'pnpm docker');

      expect(results.map((r) => r.memory.id)).toEqual(['both', 'one']);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it('builds an OR of case-insensitive contains, one branch per term', async () => {
      await service().lexicalSearch(mockUserId, 'pnpm docker');

      const where = prisma.memory.findMany.mock.calls[0]![0].where;
      expect(where.OR).toEqual([
        { content: { contains: 'pnpm', mode: 'insensitive' } },
        { content: { contains: 'docker', mode: 'insensitive' } },
      ]);
    });

    it('always constrains to the caller and to long-term memories', async () => {
      await service().lexicalSearch(mockUserId, 'pnpm');

      const where = prisma.memory.findMany.mock.calls[0]![0].where;
      expect(where.userId).toBe(mockUserId);
      expect(where.type).toBe(MemoryType.LONG_TERM);
    });

    it('mirrors every semantic filter: org, scope, tags and date bounds', async () => {
      const createdFrom = new Date('2025-01-01T00:00:00Z');
      const createdTo = new Date('2025-06-01T00:00:00Z');

      await service().lexicalSearch(mockUserId, 'pnpm', {
        organizationId: 'org-1',
        scope: 'project-a',
        tags: ['tooling', 'build'],
        createdFrom,
        createdTo,
      });

      const where = prisma.memory.findMany.mock.calls[0]![0].where;
      expect(where.organizationId).toBe('org-1');
      expect(where.scope).toBe('project-a');
      expect(where.createdAt).toEqual({ gte: createdFrom, lte: createdTo });
    });

    it('requires ALL supplied tags (hasEvery), matching the vector store’s "tags" @> filter', async () => {
      // The vector store filters with the Postgres containment operator, so the
      // semantic path requires every tag. Using hasSome here would make the
      // degraded path return memories semantic recall would have excluded.
      await service().lexicalSearch(mockUserId, 'pnpm', { tags: ['a', 'b'] });

      const where = prisma.memory.findMany.mock.calls[0]![0].where;
      expect(where.tags).toEqual({ hasEvery: ['a', 'b'] });
    });

    it('drops superseded memories by default so a stale fact cannot resurface', async () => {
      prisma.memory.findMany.mockResolvedValue([
        buildMemory({ id: 'live', content: 'pnpm is current' }),
        buildMemory({
          id: 'stale',
          content: 'pnpm was replaced',
          metadata: { supersededBy: 'live' },
        }),
        buildMemory({
          id: 'stale-status',
          content: 'pnpm old note',
          metadata: { status: 'superseded' },
        }),
      ]);

      const results = await service().lexicalSearch(mockUserId, 'pnpm');

      expect(results.map((r) => r.memory.id)).toEqual(['live']);
    });

    it('includes superseded memories when explicitly asked', async () => {
      prisma.memory.findMany.mockResolvedValue([
        buildMemory({ id: 'live', content: 'pnpm is current' }),
        buildMemory({
          id: 'stale',
          content: 'pnpm was replaced',
          metadata: { supersededBy: 'live' },
        }),
      ]);

      const results = await service().lexicalSearch(mockUserId, 'pnpm', {
        includeSuperseded: true,
      });

      expect(results.map((r) => r.memory.id).sort()).toEqual(['live', 'stale']);
    });

    it('over-fetches like the semantic path and trims to the requested limit', async () => {
      prisma.memory.findMany.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => buildMemory({ id: `m-${i}`, content: 'pnpm note' }))
      );

      const results = await service().lexicalSearch(mockUserId, 'pnpm', { limit: 4 });

      expect(prisma.memory.findMany.mock.calls[0]![0].take).toBe(12);
      expect(results).toHaveLength(4);
    });

    it('caps the over-fetch window so a huge limit cannot scan unbounded rows', async () => {
      await service().lexicalSearch(mockUserId, 'pnpm', { limit: 500 });

      expect(prisma.memory.findMany.mock.calls[0]![0].take).toBe(100);
    });

    it.each([
      ['an empty query', ''],
      ['whitespace only', '   '],
      ['punctuation only', '???'],
    ])('returns nothing and does not query the database for %s', async (_label, query) => {
      const results = await service().lexicalSearch(mockUserId, query);

      expect(results).toEqual([]);
      expect(prisma.memory.findMany).not.toHaveBeenCalled();
    });

    it('wraps database failures in an LtmDatabaseError naming the operation', async () => {
      prisma.memory.findMany.mockRejectedValue(new Error('connection reset'));

      await expect(service().lexicalSearch(mockUserId, 'pnpm')).rejects.toThrow(/lexicalSearch/);
    });
  });
});
