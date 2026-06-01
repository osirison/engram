import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryLtmService } from './memory-ltm.service';
import { MemoryType } from '@engram/database';
import type { VectorStore } from '@engram/vector-store';

const mockUserId = 'cldx4k8xp000108l83h4y8v2q';

function buildMemory(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: mockUserId,
    content: `content-${id}`,
    metadata: { scope: 'session-1' },
    tags: ['test'],
    type: MemoryType.LONG_TERM,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: null,
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

describe('MemoryLtmService.reindex', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddings: any;
  let vectorStore: VectorStore & {
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    ensureReady: ReturnType<typeof vi.fn>;
  };
  let service: MemoryLtmService;

  beforeEach(() => {
    prisma = {
      memory: {
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    embeddings = {
      generate: vi.fn().mockResolvedValue({ embedding: [0.4, 0.5, 0.6] }),
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

  it('returns an empty summary when no vector store is configured', async () => {
    const noStore = new MemoryLtmService(prisma, undefined, embeddings, undefined);
    const result = await noStore.reindex();
    expect(result).toEqual({ processed: 0, indexed: 0, skipped: 0, failed: 0, cursor: null });
    expect(prisma.memory.findMany).not.toHaveBeenCalled();
  });

  it('pages through memories and upserts reused embeddings', async () => {
    prisma.memory.findMany
      .mockResolvedValueOnce([buildMemory('a'), buildMemory('b')])
      .mockResolvedValueOnce([buildMemory('c')]);

    const result = await service.reindex({ batchSize: 2 });

    expect(result).toEqual({ processed: 3, indexed: 3, skipped: 0, failed: 0, cursor: null });
    expect(vectorStore.upsert).toHaveBeenCalledTimes(3);
    // Reused embeddings: embeddings service is never called.
    expect(embeddings.generate).not.toHaveBeenCalled();
    // Cursor-based paging: second call resumes after the last id of batch one.
    expect(prisma.memory.findMany.mock.calls[1][0]).toMatchObject({
      skip: 1,
      cursor: { id: 'b' },
    });
  });

  it('regenerates embeddings when reuse is disabled', async () => {
    prisma.memory.findMany.mockResolvedValueOnce([buildMemory('a')]).mockResolvedValueOnce([]);

    const result = await service.reindex({ reuseExistingEmbeddings: false, batchSize: 1 });

    expect(embeddings.generate).toHaveBeenCalledWith({ text: 'content-a' });
    expect(vectorStore.upsert).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', vector: [0.4, 0.5, 0.6] }),
    ]);
    expect(result.indexed).toBe(1);
  });

  it('skips memories that produce no embedding', async () => {
    prisma.memory.findMany
      .mockResolvedValueOnce([buildMemory('a', { embedding: [] })])
      .mockResolvedValueOnce([]);
    embeddings.generate.mockResolvedValueOnce({ embedding: [] });

    const result = await service.reindex({ batchSize: 1 });

    expect(result.skipped).toBe(1);
    expect(result.indexed).toBe(0);
    expect(vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('counts per-item failures without aborting the run', async () => {
    prisma.memory.findMany
      .mockResolvedValueOnce([buildMemory('a'), buildMemory('b')])
      .mockResolvedValueOnce([]);
    vectorStore.upsert.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);

    const result = await service.reindex({ batchSize: 2 });

    expect(result.failed).toBe(1);
    expect(result.indexed).toBe(1);
    expect(result.processed).toBe(2);
  });

  it('honours maxMemories and userId scoping', async () => {
    prisma.memory.findMany.mockResolvedValueOnce([buildMemory('a')]);

    const result = await service.reindex({ userId: mockUserId, maxMemories: 1, batchSize: 5 });

    expect(prisma.memory.findMany.mock.calls[0][0]).toMatchObject({
      take: 1,
      where: { type: MemoryType.LONG_TERM, userId: mockUserId },
    });
    expect(result.processed).toBe(1);
    expect(result.cursor).toBe('a');
  });

  it('reports progress after each batch', async () => {
    prisma.memory.findMany
      .mockResolvedValueOnce([buildMemory('a')])
      .mockResolvedValueOnce([buildMemory('b')])
      .mockResolvedValueOnce([]);
    const onProgress = vi.fn();

    await service.reindex({ batchSize: 1, onProgress });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ processed: 1, indexed: 1, cursor: 'a' })
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ processed: 2, indexed: 2, cursor: 'b' })
    );
  });
});
