import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { MemoryLtmService } from './memory-ltm.service.js';
import { VECTOR_STORE_TOKEN } from '@engram/vector-store';
import { MemoryType } from '@engram/database';

describe('MemoryLtmModule integration', () => {
  let service: MemoryLtmService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddings: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vectorStore: any;

  const userId = 'cldx4k8xp000108l83h4y8v2q';

  beforeEach(async () => {
    prisma = {
      memory: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'ltm-memory-1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            ...data,
          })
        ),
      },
    };

    embeddings = {
      generate: vi.fn().mockResolvedValue({
        embedding: [0.11, 0.22, 0.33],
        model: 'text-embedding-3-small',
        cached: false,
      }),
    };

    vectorStore = {
      backend: 'qdrant' as const,
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      ensureReady: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: MemoryLtmService,
          useFactory: () =>
            new MemoryLtmService(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              prisma as any,
              undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              embeddings as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              vectorStore as any
            ),
        },
        { provide: VECTOR_STORE_TOKEN, useValue: vectorStore },
      ],
    }).compile();

    service = moduleRef.get(MemoryLtmService);
  });

  it('persists generated embeddings to PostgreSQL create payload', async () => {
    await service.create({
      userId,
      content: 'Persist this with embedding',
      tags: ['integration'],
    });

    expect(embeddings.generate).toHaveBeenCalledWith({ text: 'Persist this with embedding' });
    expect(prisma.memory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        content: 'Persist this with embedding',
        type: MemoryType.LONG_TERM,
        embedding: [0.11, 0.22, 0.33],
      }),
    });
  });

  it('upserts vector into the vector store after create', async () => {
    await service.create({
      userId,
      content: 'Index this in the vector store',
      tags: ['search'],
    });

    expect(vectorStore.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'ltm-memory-1',
        vector: [0.11, 0.22, 0.33],
        payload: expect.objectContaining({ userId, type: MemoryType.LONG_TERM }),
      }),
    ]);
  });

  it('create succeeds even when vector store upsert fails (non-fatal)', async () => {
    vectorStore.upsert.mockRejectedValueOnce(new Error('vector store unavailable'));

    const memory = await service.create({
      userId,
      content: 'Still create memory when vector store fails',
    });

    expect(memory).toBeDefined();
    expect(memory.id).toBe('ltm-memory-1');
  });

  it('stores an empty embedding vector when provider fails', async () => {
    embeddings.generate.mockRejectedValueOnce(new Error('provider down'));

    await service.create({
      userId,
      content: 'Still create memory when embedding fails',
    });

    expect(prisma.memory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        embedding: [],
      }),
    });
  });
});
