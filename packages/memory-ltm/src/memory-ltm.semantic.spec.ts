import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryLtmService } from './memory-ltm.service';
import { MemoryType } from '@engram/database';
import type { VectorStore } from '@engram/vector-store';

const mockUserId = 'cldx4k8xp000108l83h4y8v2q';
const mockMemoryId = 'cldx4k8xp000208l84b5c9w3r';

function buildMemory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: mockMemoryId,
    userId: mockUserId,
    content: 'Test memory content',
    // Scope is a first-class column (not metadata) — the vector payload reads it
    // from here, so the mock row must carry it as a top-level field.
    scope: 'session-1',
    metadata: null,
    tags: ['test'],
    type: MemoryType.LONG_TERM,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: null,
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

describe('MemoryLtmService — vector lifecycle & semantic search', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddings: any;
  let vectorStore: VectorStore & {
    ensureReady: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };
  let service: MemoryLtmService;

  beforeEach(() => {
    prisma = {
      memory: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      // Interactive transactions run against the mock itself (the advisory-lock
      // quota transaction in create/promote needs tx.$executeRaw + tx.memory.*).
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    embeddings = {
      generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
    };
    vectorStore = {
      backend: 'qdrant',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
    } as unknown as typeof vectorStore;

    service = new MemoryLtmService(prisma, undefined, embeddings, vectorStore);
  });

  describe('create', () => {
    it('upserts the embedding into the vector store with a scoped payload', async () => {
      prisma.memory.create.mockResolvedValue(buildMemory());

      await service.create({
        userId: mockUserId,
        content: 'Test memory content',
        scope: 'session-1',
        tags: ['test'],
      });

      expect(vectorStore.upsert).toHaveBeenCalledWith([
        {
          id: mockMemoryId,
          vector: [0.1, 0.2, 0.3],
          payload: {
            userId: mockUserId,
            type: MemoryType.LONG_TERM,
            tags: ['test'],
            scope: 'session-1',
            createdAt: new Date('2025-01-01T00:00:00Z').getTime(),
          },
        },
      ]);
    });

    it('does not fail creation when the vector store upsert throws', async () => {
      prisma.memory.create.mockResolvedValue(buildMemory());
      vectorStore.upsert.mockRejectedValue(new Error('qdrant down'));

      await expect(
        service.create({ userId: mockUserId, content: 'Test memory content' })
      ).resolves.toMatchObject({ id: mockMemoryId });
    });

    it('never embeds a memory flagged embeddingExcluded', async () => {
      prisma.memory.create.mockResolvedValue(
        buildMemory({ metadata: { embeddingExcluded: true }, embedding: [] })
      );

      await service.create({
        userId: mockUserId,
        content: 'token ghp_secretsecretsecretsecretsecretsecret',
        metadata: { embeddingExcluded: true },
      });

      // Assert on the spy call count (not the flag) — the flag being inert was
      // exactly the bug this closes.
      expect(embeddings.generate).not.toHaveBeenCalled();
      expect(vectorStore.upsert).not.toHaveBeenCalled();
    });

    it('embeds a normal (non-excluded) memory — control', async () => {
      prisma.memory.create.mockResolvedValue(buildMemory());

      await service.create({ userId: mockUserId, content: 'ordinary note' });

      expect(embeddings.generate).toHaveBeenCalled();
    });
  });

  describe('embeddingExcluded on update / reembed / restore', () => {
    it('update never re-embeds an embeddingExcluded memory on a content edit', async () => {
      prisma.memory.findFirst.mockResolvedValue(
        buildMemory({ metadata: { embeddingExcluded: true }, embedding: [] })
      );
      prisma.memory.update.mockResolvedValue(
        buildMemory({ metadata: { embeddingExcluded: true }, embedding: [], content: 'edited' })
      );

      await service.update(mockUserId, mockMemoryId, { content: 'edited secret content' });

      expect(embeddings.generate).not.toHaveBeenCalled();
      expect(vectorStore.upsert).not.toHaveBeenCalled();
    });

    it('update still embeds a normal memory on a content edit — control', async () => {
      prisma.memory.findFirst.mockResolvedValue(buildMemory({ metadata: {} }));
      prisma.memory.update.mockResolvedValue(buildMemory({ content: 'edited' }));

      await service.update(mockUserId, mockMemoryId, { content: 'edited content' });

      expect(embeddings.generate).toHaveBeenCalledWith({ text: 'edited content' });
    });

    it('reembed is a no-op for an embeddingExcluded memory', async () => {
      prisma.memory.findFirst.mockResolvedValue(
        buildMemory({ metadata: { embeddingExcluded: true } })
      );

      const result = await service.reembed(mockUserId, mockMemoryId);

      expect(embeddings.generate).not.toHaveBeenCalled();
      expect(vectorStore.upsert).not.toHaveBeenCalled();
      expect(result.id).toBe(mockMemoryId);
    });

    it('restore does not embed an embeddingExcluded snapshot', async () => {
      prisma.memory.create.mockResolvedValue(
        buildMemory({ metadata: { embeddingExcluded: true }, embedding: [] })
      );

      await service.restore({
        id: mockMemoryId,
        userId: mockUserId,
        content: 'restored secret',
        metadata: { embeddingExcluded: true },
      });

      expect(embeddings.generate).not.toHaveBeenCalled();
      expect(vectorStore.upsert).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes the vector after a successful delete', async () => {
      prisma.memory.deleteMany.mockResolvedValue({ count: 1 });

      const deleted = await service.delete(mockUserId, mockMemoryId);

      expect(deleted).toBe(true);
      expect(vectorStore.delete).toHaveBeenCalledWith([mockMemoryId]);
    });

    it('does not touch the vector store when nothing was deleted', async () => {
      prisma.memory.deleteMany.mockResolvedValue({ count: 0 });

      await service.delete(mockUserId, mockMemoryId);

      expect(vectorStore.delete).not.toHaveBeenCalled();
    });
  });

  describe('semanticSearch', () => {
    it('embeds the query, searches with a tenant filter, and returns blended-ranked results', async () => {
      vectorStore.search.mockResolvedValue([
        { id: mockMemoryId, score: 0.91, payload: { userId: mockUserId } },
      ]);
      prisma.memory.findMany.mockResolvedValue([buildMemory()]);

      const results = await service.semanticSearch(mockUserId, 'what did I learn', {
        limit: 5,
        scope: 'session-1',
        tags: ['test'],
      });

      expect(embeddings.generate).toHaveBeenCalledWith({ text: 'what did I learn' });
      // Over-fetches limit*3 candidates for re-ranking
      expect(vectorStore.search).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        {
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
          scope: 'session-1',
          tags: ['test'],
        },
        15
      );
      expect(results).toHaveLength(1);
      // Score is the blended ranking score, not raw similarity
      expect(results[0]?.score).toBeGreaterThan(0);
      expect(results[0]?.score).toBeLessThanOrEqual(1);
      expect(results[0]?.memory.id).toBe(mockMemoryId);
    });

    it('forwards a created time range to the vector store filter', async () => {
      vectorStore.search.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      const createdFrom = new Date('2025-01-01T00:00:00Z');
      const createdTo = new Date('2025-02-01T00:00:00Z');
      await service.semanticSearch(mockUserId, 'query', { createdFrom, createdTo });

      // Default limit=10 → over-fetch 30
      expect(vectorStore.search).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        {
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
          scope: undefined,
          tags: undefined,
          createdFrom,
          createdTo,
        },
        30
      );
    });

    it('re-ranks results by blended score and drops hits without a backing row', async () => {
      // Both memories share the same createdAt so recency scores are equal.
      // 'b' has higher similarity (0.9 vs 0.7); similarity dominates → 'b' first.
      vectorStore.search.mockResolvedValue([
        { id: 'b', score: 0.9 },
        { id: 'missing', score: 0.8 },
        { id: 'a', score: 0.7 },
      ]);
      prisma.memory.findMany.mockResolvedValue([
        buildMemory({ id: 'a' }),
        buildMemory({ id: 'b' }),
      ]);

      const results = await service.semanticSearch(mockUserId, 'query');

      expect(results.map((r) => r.memory.id)).toEqual(['b', 'a']);
    });

    it('uses default weights when rankingWeights contains undefined values', async () => {
      vectorStore.search.mockResolvedValue([{ id: mockMemoryId, score: 0.8 }]);
      prisma.memory.findMany.mockResolvedValue([buildMemory()]);

      // Passing { similarity: undefined } must not produce NaN scores
      const results = await service.semanticSearch(mockUserId, 'query', {
        rankingWeights: { similarity: undefined as unknown as number },
      });

      expect(results).toHaveLength(1);
      expect(Number.isFinite(results[0]?.score)).toBe(true);
      expect(results[0]?.score).toBeGreaterThan(0);
    });

    it('falls back to default half-life for invalid recencyHalfLifeDays values', async () => {
      vectorStore.search.mockResolvedValue([{ id: mockMemoryId, score: 0.8 }]);
      prisma.memory.findMany.mockResolvedValue([buildMemory()]);

      for (const invalid of [0, -10, Infinity, -Infinity, NaN]) {
        const results = await service.semanticSearch(mockUserId, 'query', {
          recencyHalfLifeDays: invalid,
        });
        expect(results).toHaveLength(1);
        expect(Number.isFinite(results[0]?.score)).toBe(true);
      }
    });

    it('returns an empty array when the query is blank', async () => {
      const results = await service.semanticSearch(mockUserId, '   ');
      expect(results).toEqual([]);
      expect(vectorStore.search).not.toHaveBeenCalled();
    });

    it('returns an empty array when no query embedding is produced', async () => {
      embeddings.generate.mockResolvedValue(null);
      const results = await service.semanticSearch(mockUserId, 'query');
      expect(results).toEqual([]);
      expect(vectorStore.search).not.toHaveBeenCalled();
    });

    it('returns an empty array when no vector store is configured', async () => {
      const noVectorService = new MemoryLtmService(prisma, undefined, embeddings, undefined);
      const results = await noVectorService.semanticSearch(mockUserId, 'query');
      expect(results).toEqual([]);
    });

    describe('superseded exclusion', () => {
      const activeId = 'cldx4k8xp000308l85d6e0x4s';
      const supersededId = 'cldx4k8xp000408l86e7f1y5t';

      function seedActiveAndSuperseded(): void {
        vectorStore.search.mockResolvedValue([
          { id: activeId, score: 0.9 },
          { id: supersededId, score: 0.85 },
        ]);
        prisma.memory.findMany.mockResolvedValue([
          buildMemory({ id: activeId, metadata: { status: 'active' } }),
          buildMemory({
            id: supersededId,
            metadata: {
              status: 'superseded',
              supersededBy: activeId,
              supersededReason: 'contradiction',
            },
          }),
        ]);
      }

      it('drops superseded memories from recall by default', async () => {
        seedActiveAndSuperseded();

        const results = await service.semanticSearch(mockUserId, 'query');

        expect(results.map((r) => r.memory.id)).toEqual([activeId]);
      });

      it('includes superseded memories when includeSuperseded is set', async () => {
        seedActiveAndSuperseded();

        const results = await service.semanticSearch(mockUserId, 'query', {
          includeSuperseded: true,
        });

        expect(results.map((r) => r.memory.id).sort()).toEqual([activeId, supersededId].sort());
      });

      it('excludes on the supersededBy marker even after decay rewrote status', async () => {
        // Decay rewrites `status` to active/stale/archived on every run, so a
        // superseded row can carry status='stale' while still being superseded.
        vectorStore.search.mockResolvedValue([{ id: supersededId, score: 0.9 }]);
        prisma.memory.findMany.mockResolvedValue([
          buildMemory({
            id: supersededId,
            metadata: { status: 'stale', supersededBy: activeId },
          }),
        ]);

        const results = await service.semanticSearch(mockUserId, 'query');

        expect(results).toEqual([]);
      });
    });

    describe('contradicted rows keep surfacing (G3-T4, policy flag)', () => {
      const activeId = 'cldx4k8xp000308l85d6e0x4s';
      const contradictedId = 'cldx4k8xp000508l87f8g2z6u';

      it('default recall returns BOTH rows of a flagged pair, review fields intact', async () => {
        // Unlike supersede, a contradiction flag hides nothing: the G3-T1
        // filter keys on supersededBy / status='superseded' only, so a
        // status='contradicted' row (no supersededBy marker) must pass it.
        vectorStore.search.mockResolvedValue([
          { id: activeId, score: 0.9 },
          { id: contradictedId, score: 0.85 },
        ]);
        prisma.memory.findMany.mockResolvedValue([
          buildMemory({
            id: activeId,
            metadata: {
              status: 'contradicted',
              contradictionWith: contradictedId,
              contradictionReason: 'negation asymmetry',
              contradictedAt: '2025-01-02T00:00:00.000Z',
            },
          }),
          buildMemory({
            id: contradictedId,
            metadata: {
              status: 'contradicted',
              contradictionWith: activeId,
              contradictionReason: 'negation asymmetry',
              contradictedAt: '2025-01-02T00:00:00.000Z',
            },
          }),
        ]);

        const results = await service.semanticSearch(mockUserId, 'query');

        expect(results.map((r) => r.memory.id).sort()).toEqual([activeId, contradictedId].sort());
        // The flag stays visible to callers through the result's metadata.
        const contradicted = results.find((r) => r.memory.id === contradictedId);
        expect(contradicted?.memory.metadata).toEqual(
          expect.objectContaining({
            status: 'contradicted',
            contradictionWith: activeId,
            contradictionReason: 'negation asymmetry',
            contradictedAt: expect.any(String),
          })
        );
      });

      it('still surfaces a contradicted row after decay rewrote its status', async () => {
        // `contradictionWith` is the durable marker; a decay pass may rewrite
        // status to active/stale, and the row must keep surfacing either way.
        vectorStore.search.mockResolvedValue([{ id: contradictedId, score: 0.9 }]);
        prisma.memory.findMany.mockResolvedValue([
          buildMemory({
            id: contradictedId,
            metadata: { status: 'stale', contradictionWith: activeId },
          }),
        ]);

        const results = await service.semanticSearch(mockUserId, 'query');

        expect(results.map((r) => r.memory.id)).toEqual([contradictedId]);
      });
    });
  });
});
