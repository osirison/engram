import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryLtmService } from './memory-ltm.service';
import {
  LtmMemoryNotFoundError,
  LtmMemoryQuotaExceededError,
  LtmPromotionError,
  LtmDatabaseError,
  DEFAULT_LTM_CONFIG,
} from './types';
import { MemoryType } from '@engram/database';
import { ImportanceScoringService } from './importance.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ContradictionDetectionService } from './contradiction-detection.service';
import { IngestPipelineService } from './ingest/ingest-pipeline.service.js';
import { PrivacyFilterStep } from './ingest/privacy-filter.step.js';
import { TopicDetectorStep } from './ingest/topic-detector.step.js';

describe('MemoryLtmService', () => {
  let service: MemoryLtmService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stmService: any;

  const mockUserId = 'cldx4k8xp000108l83h4y8v2q';
  const mockMemoryId = 'cldx4k8xp000208l84b5c9w3r';
  const mockMemory = {
    id: mockMemoryId,
    userId: mockUserId,
    content: 'Test memory content',
    metadata: { test: 'data' },
    tags: ['test', 'memory'],
    type: MemoryType.LONG_TERM,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: null,
    embedding: [],
  };

  const mockStmMemory = {
    id: mockMemoryId,
    userId: mockUserId,
    content: 'STM memory content',
    metadata: { stm: 'data' },
    tags: ['stm', 'test'],
    type: 'short-term' as const,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: new Date('2025-01-02T00:00:00Z'),
    ttl: 86400,
  };

  beforeEach(async () => {
    const mockPrismaService = {
      memory: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    const mockStmService = {
      findById: vi.fn(),
      delete: vi.fn(),
    };

    // Create service directly with mocks instead of using testing module
    service = new MemoryLtmService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrismaService as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockStmService as any
    );

    prismaService = mockPrismaService;
    stmService = mockStmService;
  });

  describe('create', () => {
    const createInput = {
      userId: mockUserId,
      content: 'New memory content',
      metadata: { key: 'value' },
      tags: ['new', 'test'],
    };

    it('should create a new long-term memory', async () => {
      prismaService.memory.count.mockResolvedValue(0); // Under quota
      prismaService.memory.create.mockResolvedValue(mockMemory);

      const result = await service.create(createInput);

      expect(prismaService.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: createInput.userId,
          content: createInput.content,
          metadata: createInput.metadata,
          tags: createInput.tags,
          type: MemoryType.LONG_TERM,
          expiresAt: null,
        }),
      });
      expect(result).toEqual(
        expect.objectContaining({
          ...mockMemory,
          type: 'long-term',
          expiresAt: null,
        })
      );
    });

    it('should throw quota exceeded error when user has too many memories', async () => {
      prismaService.memory.count.mockResolvedValue(DEFAULT_LTM_CONFIG.maxMemoriesPerUser);

      await expect(service.create(createInput)).rejects.toThrow(LtmMemoryQuotaExceededError);
    });

    it('should throw database error on prisma failure', async () => {
      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.create.mockRejectedValue(new Error('Database error'));

      await expect(service.create(createInput)).rejects.toThrow(LtmDatabaseError);
    });

    it('should validate input and use defaults for optional fields', async () => {
      const minimalInput = {
        userId: mockUserId,
        content: 'Minimal content',
      };

      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.findFirst.mockResolvedValue(null);
      prismaService.memory.create.mockResolvedValue(mockMemory);

      await service.create(minimalInput);

      expect(prismaService.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: {},
          tags: [],
        }),
      });
    });
  });

  describe('create with IngestPipelineService', () => {
    let serviceWithPipeline: MemoryLtmService;

    beforeEach(() => {
      const pipeline = new IngestPipelineService(new PrivacyFilterStep(), new TopicDetectorStep());
      serviceWithPipeline = new MemoryLtmService(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaService as any,
        undefined, // stm
        undefined, // embeddings
        undefined, // vectorStore
        undefined, // importanceService
        undefined, // duplicateDetectionService
        pipeline
      );
    });

    it('redacts credential content before the Postgres write', async () => {
      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.findFirst.mockResolvedValue(null);
      prismaService.memory.create.mockResolvedValue({
        ...mockMemory,
        content: 'user set password = [REDACTED]',
      });

      await serviceWithPipeline.create({
        userId: mockUserId,
        content: 'user set password = hunter2',
      });

      const callArg = prismaService.memory.create.mock.calls[0][0].data;
      expect(callArg.content).not.toContain('hunter2');
      expect(callArg.content).toContain('[REDACTED]');
    });

    it('auto-tags topic buckets from content before the Postgres write', async () => {
      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.findFirst.mockResolvedValue(null);
      prismaService.memory.create.mockResolvedValue({
        ...mockMemory,
        tags: ['decision', 'engineering'],
      });

      await serviceWithPipeline.create({
        userId: mockUserId,
        content: 'decided to refactor the typescript service',
      });

      const callArg = prismaService.memory.create.mock.calls[0][0].data;
      expect(callArg.tags).toContain('decision');
      expect(callArg.tags).toContain('engineering');
    });

    it('returns existing memory on exact content duplicate without creating', async () => {
      const existingContent = 'this is some test content';
      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.findFirst.mockResolvedValue({
        ...mockMemory,
        content: existingContent,
      });

      const result = await serviceWithPipeline.create({
        userId: mockUserId,
        content: existingContent,
      });

      expect(prismaService.memory.create).not.toHaveBeenCalled();
      expect(result.id).toBe(mockMemoryId);
    });
  });

  describe('get', () => {
    it('should return memory when found', async () => {
      prismaService.memory.findFirst.mockResolvedValue(mockMemory);

      const result = await service.get(mockUserId, mockMemoryId);

      expect(prismaService.memory.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockMemoryId,
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          ...mockMemory,
          type: 'long-term',
          expiresAt: null,
        })
      );
    });

    it('should return null when memory not found', async () => {
      prismaService.memory.findFirst.mockResolvedValue(null);

      const result = await service.get(mockUserId, mockMemoryId);

      expect(result).toBeNull();
    });

    it('should enforce user isolation', async () => {
      const otherUserId = 'other-user';
      prismaService.memory.findFirst.mockResolvedValue(null);

      await service.get(otherUserId, mockMemoryId);

      expect(prismaService.memory.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockMemoryId,
          userId: otherUserId,
          type: MemoryType.LONG_TERM,
        },
      });
    });

    it('should throw database error on prisma failure', async () => {
      prismaService.memory.findFirst.mockRejectedValue(new Error('Database error'));

      await expect(service.get(mockUserId, mockMemoryId)).rejects.toThrow(LtmDatabaseError);
    });

    it('should swallow record access failures', async () => {
      const importanceService = new ImportanceScoringService();
      const serviceWithImportance = new MemoryLtmService(
        prismaService as never,
        stmService as never,
        undefined,
        undefined,
        importanceService as never
      );
      const logger = (
        serviceWithImportance as unknown as { logger: { warn: (...args: unknown[]) => void } }
      ).logger;
      const warnSpy = vi.spyOn(logger, 'warn');
      prismaService.memory.findFirst.mockResolvedValue(mockMemory);
      prismaService.memory.update.mockRejectedValue(new Error('write failed'));

      const result = await serviceWithImportance.get(mockUserId, mockMemoryId);
      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Failed to record access for memory ${mockMemoryId}`)
        );
      });
      expect(result?.id).toBe(mockMemoryId);
    });
  });

  describe('update', () => {
    const updateInput = {
      content: 'Updated content',
      metadata: { updated: true },
      tags: ['updated'],
    };

    it('should update existing memory', async () => {
      prismaService.memory.findFirst.mockResolvedValue(mockMemory);
      prismaService.memory.update.mockResolvedValue({ ...mockMemory, ...updateInput });

      const result = await service.update(mockUserId, mockMemoryId, updateInput);

      expect(prismaService.memory.update).toHaveBeenCalledWith({
        where: {
          id: mockMemoryId,
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
        },
        data: {
          content: updateInput.content,
          metadata: updateInput.metadata,
          tags: updateInput.tags,
        },
      });
      expect(result.content).toBe(updateInput.content);
    });

    it('should throw not found error when memory does not exist', async () => {
      prismaService.memory.findFirst.mockResolvedValue(null);

      await expect(service.update(mockUserId, mockMemoryId, updateInput)).rejects.toThrow(
        LtmMemoryNotFoundError
      );
    });

    it('should only update provided fields', async () => {
      const partialUpdate = { content: 'New content only' };

      prismaService.memory.findFirst.mockResolvedValue(mockMemory);
      prismaService.memory.update.mockResolvedValue(mockMemory);

      await service.update(mockUserId, mockMemoryId, partialUpdate);

      expect(prismaService.memory.update).toHaveBeenCalledWith({
        where: {
          id: mockMemoryId,
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
        },
        data: expect.objectContaining({
          content: 'New content only',
          metadata: expect.objectContaining({
            test: 'data',
          }),
        }),
      });
    });
  });

  describe('delete', () => {
    it('should delete memory and return true when successful', async () => {
      prismaService.memory.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.delete(mockUserId, mockMemoryId);

      expect(prismaService.memory.deleteMany).toHaveBeenCalledWith({
        where: {
          id: mockMemoryId,
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
        },
      });
      expect(result).toBe(true);
    });

    it('should return false when memory not found', async () => {
      prismaService.memory.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.delete(mockUserId, mockMemoryId);

      expect(result).toBe(false);
    });

    it('should enforce user isolation', async () => {
      const otherUserId = 'other-user';
      prismaService.memory.deleteMany.mockResolvedValue({ count: 0 });

      await service.delete(otherUserId, mockMemoryId);

      expect(prismaService.memory.deleteMany).toHaveBeenCalledWith({
        where: {
          id: mockMemoryId,
          userId: otherUserId,
          type: MemoryType.LONG_TERM,
        },
      });
    });
  });

  describe('list', () => {
    const mockMemories = [mockMemory, { ...mockMemory, id: 'cldx4k8xp000308l85c6d0x4s' }];

    it('should return paginated list of memories', async () => {
      prismaService.memory.count.mockResolvedValue(2);
      prismaService.memory.findMany.mockResolvedValue(mockMemories);

      const result = await service.list(mockUserId);

      expect(result).toEqual({
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'long-term', expiresAt: null }),
        ]),
        totalCount: 2,
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: mockMemory.id,
        endCursor: 'cldx4k8xp000308l85c6d0x4s',
      });
    });

    it('should apply filters correctly', async () => {
      const options = {
        tags: ['test'],
        dateFrom: new Date('2025-01-01'),
        dateTo: new Date('2025-01-02'),
        search: 'content',
        sortBy: 'updatedAt' as const,
        sortOrder: 'asc' as const,
      };

      prismaService.memory.count.mockResolvedValue(1);
      prismaService.memory.findMany.mockResolvedValue([mockMemory]);

      await service.list(mockUserId, options);

      expect(prismaService.memory.findMany).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
          tags: { hasSome: options.tags },
          createdAt: {
            gte: options.dateFrom,
            lte: options.dateTo,
          },
          content: {
            contains: options.search,
            mode: 'insensitive',
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: 21, // limit + 1
        cursor: undefined,
        skip: 0,
      });
    });

    it('should handle cursor-based pagination', async () => {
      const options = { cursor: 'cldx4k8xp000708l89g0h4b8w', limit: 10 };

      prismaService.memory.count.mockResolvedValue(1);
      prismaService.memory.findMany.mockResolvedValue([mockMemory]);

      await service.list(mockUserId, options);

      expect(prismaService.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'cldx4k8xp000708l89g0h4b8w' },
          skip: 1,
          take: 11, // limit + 1
        })
      );
    });

    it('should detect next page correctly', async () => {
      const manyMemories = Array(21).fill(mockMemory);
      prismaService.memory.count.mockResolvedValue(25);
      prismaService.memory.findMany.mockResolvedValue(manyMemories);

      const result = await service.list(mockUserId, { limit: 20 });

      expect(result.hasNextPage).toBe(true);
      expect(result.items).toHaveLength(20); // Extra item removed
    });
  });

  describe('count', () => {
    it('should return total count of user memories', async () => {
      prismaService.memory.count.mockResolvedValue(5);

      const result = await service.count(mockUserId);

      expect(prismaService.memory.count).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
        },
      });
      expect(result).toBe(5);
    });

    it('should apply filters to count', async () => {
      const filters = {
        tags: ['test'],
        search: 'content',
      };

      prismaService.memory.count.mockResolvedValue(3);

      await service.count(mockUserId, filters);

      expect(prismaService.memory.count).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
          tags: { hasSome: filters.tags },
          content: {
            contains: filters.search,
            mode: 'insensitive',
          },
        },
      });
    });
  });

  describe('clear', () => {
    it('should clear all user memories and return count', async () => {
      prismaService.memory.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.clear(mockUserId);

      expect(prismaService.memory.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
        },
      });
      expect(result).toBe(10);
    });

    it('should enforce user isolation', async () => {
      const otherUserId = 'other-user';
      prismaService.memory.deleteMany.mockResolvedValue({ count: 0 });

      await service.clear(otherUserId);

      expect(prismaService.memory.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: otherUserId,
          type: MemoryType.LONG_TERM,
        },
      });
    });
  });

  describe('promote', () => {
    it('should successfully promote memory from STM to LTM', async () => {
      stmService.findById.mockResolvedValue(mockStmMemory);
      stmService.delete.mockResolvedValue(undefined);

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          memory: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue(mockMemory),
          },
        };
        return callback(mockTx);
      });

      prismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.promote(mockUserId, mockMemoryId);

      expect(stmService.findById).toHaveBeenCalledWith(
        mockUserId,
        mockMemoryId,
        undefined,
        undefined,
      );
      expect(stmService.delete).toHaveBeenCalledWith(mockUserId, mockMemoryId, undefined);
      expect(result).toEqual(
        expect.objectContaining({
          type: 'long-term',
          expiresAt: null,
        })
      );
    });

    it('should throw error when STM service not available', async () => {
      const serviceWithoutStm = new MemoryLtmService(prismaService);

      await expect(serviceWithoutStm.promote(mockUserId, mockMemoryId)).rejects.toThrow(
        LtmPromotionError
      );
    });

    it('should throw error when memory not found in STM', async () => {
      stmService.findById.mockResolvedValue(null);

      await expect(service.promote(mockUserId, mockMemoryId)).rejects.toThrow(LtmPromotionError);
    });

    it('should handle quota exceeded during promotion', async () => {
      stmService.findById.mockResolvedValue(mockStmMemory);

      // Mock the main prisma service to return quota exceeded count
      prismaService.memory.count.mockResolvedValue(DEFAULT_LTM_CONFIG.maxMemoriesPerUser);

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          memory: {
            create: vi.fn(),
          },
        };
        return callback(mockTx);
      });

      prismaService.$transaction.mockImplementation(mockTransaction);

      await expect(service.promote(mockUserId, mockMemoryId)).rejects.toThrow(
        LtmMemoryQuotaExceededError
      );
    });

    it('should continue if STM deletion fails after successful LTM creation', async () => {
      stmService.findById.mockResolvedValue(mockStmMemory);
      stmService.delete.mockRejectedValue(new Error('STM delete failed'));

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          memory: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue(mockMemory),
          },
        };
        return callback(mockTx);
      });

      prismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.promote(mockUserId, mockMemoryId);

      expect(result).toEqual(
        expect.objectContaining({
          type: 'long-term',
          expiresAt: null,
        })
      );
      // Should not throw even though STM deletion failed
    });
  });

  describe('user isolation', () => {
    it('should enforce user isolation in all operations', async () => {
      const user1 = 'cldx4k8xp000408l86d7e1y5t';
      const user2 = 'cldx4k8xp000508l87e8f2z6u';
      const memoryId = 'cldx4k8xp000608l88f9g3a7v';

      // Setup mocks for isolation test
      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.create.mockResolvedValue(mockMemory);
      prismaService.memory.findFirst.mockResolvedValue(null);
      prismaService.memory.deleteMany.mockResolvedValue({ count: 0 });

      // Test create isolation
      await service.create({ userId: user1, content: 'test' });
      expect(prismaService.memory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: user1 }),
        })
      );

      // Test get isolation
      await service.get(user2, memoryId);
      expect(prismaService.memory.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: user2 }),
      });

      // Test delete isolation
      await service.delete(user2, memoryId);
      expect(prismaService.memory.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: user2 }),
      });

      // Test count isolation
      await service.count(user1);
      expect(prismaService.memory.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: user1 }),
      });

      // Test clear isolation
      await service.clear(user1);
      expect(prismaService.memory.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: user1 }),
      });
    });
  });

  describe('vector lifecycle', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let embeddingsService: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let vectorStore: any;
    let serviceWithVector: MemoryLtmService;

    beforeEach(() => {
      embeddingsService = {
        generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      };
      vectorStore = {
        backend: 'qdrant' as const,
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        ensureReady: vi.fn().mockResolvedValue(undefined),
      };
      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.create.mockResolvedValue(mockMemory);

      serviceWithVector = new MemoryLtmService(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaService as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stmService as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        embeddingsService as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vectorStore as any
      );
    });

    it('upserts vector into the store after create', async () => {
      await serviceWithVector.create({ userId: mockUserId, content: 'hello', tags: [] });

      expect(vectorStore.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: mockMemoryId,
          vector: [0.1, 0.2, 0.3],
          payload: expect.objectContaining({
            userId: mockUserId,
            type: MemoryType.LONG_TERM,
            tags: mockMemory.tags,
          }),
        }),
      ]);
    });

    it('create succeeds when vector store upsert throws (non-fatal)', async () => {
      vectorStore.upsert.mockRejectedValueOnce(new Error('store down'));

      await expect(
        serviceWithVector.create({ userId: mockUserId, content: 'hello' })
      ).resolves.toBeDefined();
    });

    it('removes vector from store on delete', async () => {
      prismaService.memory.deleteMany.mockResolvedValue({ count: 1 });

      await serviceWithVector.delete(mockUserId, mockMemoryId);

      expect(vectorStore.delete).toHaveBeenCalledWith([mockMemoryId]);
    });

    it('upserts vector into the store after promote', async () => {
      stmService.findById.mockResolvedValue(mockStmMemory);
      stmService.delete.mockResolvedValue(undefined);

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          memory: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue(mockMemory),
          },
        };
        return callback(mockTx);
      });
      prismaService.$transaction.mockImplementation(mockTransaction);

      await serviceWithVector.promote(mockUserId, mockMemoryId);

      expect(vectorStore.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: mockMemoryId,
          payload: expect.objectContaining({
            userId: mockUserId,
            type: MemoryType.LONG_TERM,
            tags: mockMemory.tags,
          }),
        }),
      ]);
    });

    it('promote succeeds when vector store upsert throws (non-fatal)', async () => {
      stmService.findById.mockResolvedValue(mockStmMemory);
      stmService.delete.mockResolvedValue(undefined);
      vectorStore.upsert.mockRejectedValueOnce(new Error('store down'));

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          memory: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue(mockMemory),
          },
        };
        return callback(mockTx);
      });
      prismaService.$transaction.mockImplementation(mockTransaction);

      await expect(serviceWithVector.promote(mockUserId, mockMemoryId)).resolves.toBeDefined();
    });
  });

  describe('stream B behaviors', () => {
    it('stores computed importance metadata on create', async () => {
      const importanceService = new ImportanceScoringService();
      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.create.mockResolvedValue(mockMemory);

      const serviceWithImportance = new MemoryLtmService(
        prismaService as never,
        stmService as never,
        undefined,
        undefined,
        importanceService as never
      );

      await serviceWithImportance.create({
        userId: mockUserId,
        content: 'Decision: keep this important note',
      });

      expect(prismaService.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            importance: expect.any(Number),
            status: expect.any(String),
          }),
        }),
      });
    });

    it('returns the existing memory when duplicate detection matches on create', async () => {
      const importanceService = new ImportanceScoringService();
      const duplicateService = new DuplicateDetectionService();
      const vectorStore = {
        backend: 'qdrant' as const,
        upsert: vi.fn(),
        delete: vi.fn(),
        ensureReady: vi.fn(),
        search: vi.fn().mockResolvedValue([{ id: mockMemoryId, score: 0.99 }]),
      };
      const embeddingsService = {
        generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      };
      prismaService.memory.count.mockResolvedValue(0);
      // First findFirst: exact-content dedup check → miss (different content is used
      // so the vector dedup path is exercised).  Second: findRawMemory in linkDuplicateAndReturn.
      prismaService.memory.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(mockMemory);
      prismaService.memory.update.mockResolvedValue(mockMemory);

      const serviceWithDuplicate = new MemoryLtmService(
        prismaService as never,
        stmService as never,
        embeddingsService as never,
        vectorStore as never,
        importanceService as never,
        duplicateService as never
      );

      const result = await serviceWithDuplicate.create({
        userId: mockUserId,
        content: 'Test memory content',
      });

      expect(prismaService.memory.create).not.toHaveBeenCalled();
      expect(prismaService.memory.update).toHaveBeenCalled();
      expect(prismaService.memory.update).toHaveBeenCalledWith({
        where: { id: mockMemoryId },
        data: {
          metadata: expect.objectContaining({
            duplicateMatches: expect.arrayContaining([
              expect.objectContaining({
                memoryId: mockMemoryId,
                score: 0.99,
              }),
            ]),
          }),
        },
      });
      expect(result.id).toBe(mockMemoryId);
    });

    it('applies decay updates and prunes low-importance memories', async () => {
      const importanceService = new ImportanceScoringService();
      const oldMemory = {
        ...mockMemory,
        id: 'old-memory',
        content: 'misc note',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        metadata: {},
      };
      const strongMemory = {
        ...mockMemory,
        id: 'strong-memory',
        content: 'Decision: keep after launch milestone',
        createdAt: new Date('2026-06-10T00:00:00Z'),
        metadata: {},
      };
      prismaService.memory.findMany
        .mockResolvedValueOnce([oldMemory, strongMemory])
        .mockResolvedValueOnce([]);
      prismaService.memory.deleteMany.mockResolvedValue({ count: 1 });
      prismaService.memory.update.mockResolvedValue(strongMemory);

      const serviceWithImportance = new MemoryLtmService(
        prismaService as never,
        stmService as never,
        undefined,
        undefined,
        importanceService as never
      );

      const result = await serviceWithImportance.applyDecayPolicy({
        pruneOlderThanDays: 30,
        pruneScoreThreshold: 0.15,
      });

      expect(result.processed).toBe(2);
      expect(result.pruned).toBe(1);
      expect(result.updated).toBe(1);
      expect(prismaService.memory.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'old-memory',
          userId: mockUserId,
          type: MemoryType.LONG_TERM,
        },
      });
    });

    it('supports dry run decay without writes', async () => {
      const importanceService = new ImportanceScoringService();
      const oldMemory = {
        ...mockMemory,
        id: 'old-memory-dry-run',
        content: 'misc note',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        metadata: {},
      };
      prismaService.memory.findMany.mockResolvedValueOnce([oldMemory]).mockResolvedValueOnce([]);

      const serviceWithImportance = new MemoryLtmService(
        prismaService as never,
        stmService as never,
        undefined,
        undefined,
        importanceService as never
      );

      const result = await serviceWithImportance.applyDecayPolicy({
        dryRun: true,
        pruneOlderThanDays: 30,
        pruneScoreThreshold: 0.15,
      });

      expect(result.processed).toBe(1);
      expect(result.pruned).toBe(1);
      expect(prismaService.memory.deleteMany).not.toHaveBeenCalled();
      expect(prismaService.memory.update).not.toHaveBeenCalled();
    });

    it('continues decay pass when a prune operation fails', async () => {
      const importanceService = new ImportanceScoringService();
      const oldMemoryA = {
        ...mockMemory,
        id: 'old-memory-a',
        content: 'misc note',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        metadata: {},
      };
      const oldMemoryB = {
        ...mockMemory,
        id: 'old-memory-b',
        content: 'misc note',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        metadata: {},
      };
      prismaService.memory.findMany
        .mockResolvedValueOnce([oldMemoryA, oldMemoryB])
        .mockResolvedValueOnce([]);
      prismaService.memory.deleteMany
        .mockRejectedValueOnce(new Error('vector failure'))
        .mockResolvedValueOnce({ count: 1 });

      const serviceWithImportance = new MemoryLtmService(
        prismaService as never,
        stmService as never,
        undefined,
        undefined,
        importanceService as never
      );

      const result = await serviceWithImportance.applyDecayPolicy({
        pruneOlderThanDays: 30,
        pruneScoreThreshold: 0.15,
      });

      expect(result.processed).toBe(2);
      expect(result.pruned).toBe(1);
      expect(prismaService.memory.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('deletes STM memory when duplicate is detected during promote', async () => {
      const importanceService = new ImportanceScoringService();
      const duplicateService = new DuplicateDetectionService();
      const vectorStore = {
        backend: 'qdrant' as const,
        upsert: vi.fn(),
        delete: vi.fn(),
        ensureReady: vi.fn(),
        search: vi.fn().mockResolvedValue([{ id: mockMemoryId, score: 0.99 }]),
      };
      const embeddingsService = {
        generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      };
      stmService.findById.mockResolvedValue(mockStmMemory);
      stmService.delete.mockResolvedValue(undefined);
      prismaService.memory.count.mockResolvedValue(0);
      prismaService.memory.findFirst.mockResolvedValue(mockMemory);
      prismaService.memory.update.mockResolvedValue(mockMemory);

      const serviceWithDuplicate = new MemoryLtmService(
        prismaService as never,
        stmService as never,
        embeddingsService as never,
        vectorStore as never,
        importanceService as never,
        duplicateService as never
      );

      await serviceWithDuplicate.promote(mockUserId, mockMemoryId);

      expect(stmService.delete).toHaveBeenCalledWith(mockUserId, mockMemoryId, undefined);
    });

    describe('contradiction detection in create()', () => {
      const oldMemoryId = 'cldx4k8xp000308l84b5c9x4s';
      const oldMemory = {
        ...mockMemory,
        id: oldMemoryId,
        content: 'I like Python',
        metadata: { importance: 0.5 },
      };
      const newMemory = { ...mockMemory, content: "I don't like Python" };

      function buildContradictionService(): MemoryLtmService {
        const importanceService = new ImportanceScoringService();
        const duplicateService = new DuplicateDetectionService();
        const contradictionService = new ContradictionDetectionService();
        const vectorStore = {
          backend: 'qdrant' as const,
          upsert: vi.fn(),
          delete: vi.fn(),
          ensureReady: vi.fn(),
          // First call: duplicate check (score 0.85 < 0.97 → no duplicate)
          // Second call: contradiction check (same hit, 0.85 is in band)
          search: vi.fn().mockResolvedValue([{ id: oldMemoryId, score: 0.85 }]),
        };
        const embeddingsService = {
          generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
        };
        prismaService.memory.count.mockResolvedValue(0);
        // exact-dup check → miss
        prismaService.memory.findFirst
          .mockResolvedValueOnce(null)
          // findRawMemory for annotateContradictor
          .mockResolvedValueOnce(oldMemory)
          // findRawMemory inside markSuperseded
          .mockResolvedValueOnce(oldMemory);
        // candidate content fetch
        prismaService.memory.findMany.mockResolvedValue([
          { id: oldMemoryId, content: oldMemory.content },
        ]);
        prismaService.memory.create.mockResolvedValue(newMemory);
        prismaService.memory.update.mockResolvedValue(oldMemory);

        return new MemoryLtmService(
          prismaService as never,
          stmService as never,
          embeddingsService as never,
          vectorStore as never,
          importanceService as never,
          duplicateService as never,
          undefined,
          contradictionService as never
        );
      }

      it('annotates new memory with contradictionMatches when contradiction is detected', async () => {
        const svc = buildContradictionService();
        const result = await svc.create({
          userId: mockUserId,
          content: "I don't like Python",
        });

        expect(prismaService.memory.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              metadata: expect.objectContaining({
                contradictionMatches: expect.arrayContaining([
                  expect.objectContaining({
                    memoryId: oldMemoryId,
                    action: 'superseded',
                    reason: 'negation asymmetry',
                  }),
                ]),
              }),
            }),
          })
        );
        expect(result.id).toBe(newMemory.id);
      });

      it('marks the older memory as superseded after the new memory is written', async () => {
        const svc = buildContradictionService();
        await svc.create({ userId: mockUserId, content: "I don't like Python" });

        expect(prismaService.memory.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: oldMemoryId }),
            data: expect.objectContaining({
              metadata: expect.objectContaining({
                status: 'superseded',
                supersededBy: newMemory.id,
                supersededReason: 'negation asymmetry',
              }),
            }),
          })
        );
      });

      it('creates memory normally when no contradiction is found', async () => {
        const importanceService = new ImportanceScoringService();
        const duplicateService = new DuplicateDetectionService();
        const contradictionService = new ContradictionDetectionService();
        const vectorStore = {
          backend: 'qdrant' as const,
          upsert: vi.fn(),
          delete: vi.fn(),
          ensureReady: vi.fn(),
          search: vi.fn().mockResolvedValue([{ id: oldMemoryId, score: 0.85 }]),
        };
        const embeddingsService = {
          generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
        };
        prismaService.memory.count.mockResolvedValue(0);
        prismaService.memory.findFirst.mockResolvedValueOnce(null);
        // No heuristic match: old content also has no negation
        prismaService.memory.findMany.mockResolvedValue([
          { id: oldMemoryId, content: 'I use Python daily' },
        ]);
        prismaService.memory.create.mockResolvedValue(newMemory);

        const svc = new MemoryLtmService(
          prismaService as never,
          stmService as never,
          embeddingsService as never,
          vectorStore as never,
          importanceService as never,
          duplicateService as never,
          undefined,
          contradictionService as never
        );

        await svc.create({ userId: mockUserId, content: 'I enjoy Python for scripting' });

        const createCall = prismaService.memory.create.mock.calls[0][0];
        expect(createCall.data.metadata).not.toHaveProperty('contradictionMatches');
        expect(prismaService.memory.update).not.toHaveBeenCalled();
      });

      it('creates memory successfully when markSuperseded fails (non-fatal)', async () => {
        const svc = buildContradictionService();
        prismaService.memory.update.mockRejectedValueOnce(new Error('DB error'));

        await expect(
          svc.create({ userId: mockUserId, content: "I don't like Python" })
        ).resolves.not.toThrow();
        expect(prismaService.memory.create).toHaveBeenCalled();
      });

      it('skips contradiction detection when service is not injected', async () => {
        const importanceService = new ImportanceScoringService();
        const duplicateService = new DuplicateDetectionService();
        const vectorStore = {
          backend: 'qdrant' as const,
          upsert: vi.fn(),
          delete: vi.fn(),
          ensureReady: vi.fn(),
          search: vi.fn().mockResolvedValue([{ id: oldMemoryId, score: 0.85 }]),
        };
        const embeddingsService = {
          generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
        };
        prismaService.memory.count.mockResolvedValue(0);
        prismaService.memory.findFirst.mockResolvedValueOnce(null);
        prismaService.memory.create.mockResolvedValue(newMemory);
        // no contradiction service → findMany and markSuperseded (update) should not be called
        prismaService.memory.findMany.mockResolvedValue([]);

        const svc = new MemoryLtmService(
          prismaService as never,
          stmService as never,
          embeddingsService as never,
          vectorStore as never,
          importanceService as never,
          duplicateService as never
          // contradictionDetectionService omitted
        );

        await svc.create({ userId: mockUserId, content: "I don't like Python" });

        expect(prismaService.memory.findMany).not.toHaveBeenCalled();
        expect(prismaService.memory.update).not.toHaveBeenCalled();
      });
    });
  });
});
