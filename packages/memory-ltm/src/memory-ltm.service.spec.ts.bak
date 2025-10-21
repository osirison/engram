import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@engram/database';
import { MemoryStmService } from '@engram/memory-stm';
import { MemoryLtmService } from './memory-ltm.service';
import {
  LtmMemoryNotFoundError,
  LtmMemoryQuotaExceededError,
  LtmPromotionError,
  LtmDatabaseError,
  DEFAULT_LTM_CONFIG,
} from './types';
import { MemoryType } from '@engram/database';

describe('MemoryLtmService', () => {
  let service: MemoryLtmService;
  let prismaService: jest.Mocked<PrismaService>;
  let stmService: jest.Mocked<MemoryStmService>;

  const mockUserId = 'user-123';
  const mockMemoryId = 'memory-456';
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
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const mockStmService = {
      findById: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryLtmService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: MemoryStmService,
          useValue: mockStmService,
        },
      ],
    }).compile();

    service = module.get<MemoryLtmService>(MemoryLtmService);
    prismaService = module.get(PrismaService);
    stmService = module.get(MemoryStmService);
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
      expect(result).toEqual(expect.objectContaining({
        ...mockMemory,
        type: 'long-term',
        expiresAt: null,
      }));
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
      prismaService.memory.create.mockResolvedValue(mockMemory);

      await service.create(minimalInput);

      expect(prismaService.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: null,
          tags: [],
        }),
      });
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
      expect(result).toEqual(expect.objectContaining({
        ...mockMemory,
        type: 'long-term',
        expiresAt: null,
      }));
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
        data: {
          content: 'New content only',
        },
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
    const mockMemories = [mockMemory, { ...mockMemory, id: 'memory-2' }];

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
        endCursor: 'memory-2',
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
      const options = { cursor: 'cursor-id', limit: 10 };

      prismaService.memory.count.mockResolvedValue(1);
      prismaService.memory.findMany.mockResolvedValue([mockMemory]);

      await service.list(mockUserId, options);

      expect(prismaService.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'cursor-id' },
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
      
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          memory: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue(mockMemory),
          },
        };
        return callback(mockTx);
      });
      
      prismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.promote(mockUserId, mockMemoryId);

      expect(stmService.findById).toHaveBeenCalledWith(mockUserId, mockMemoryId);
      expect(stmService.delete).toHaveBeenCalledWith(mockUserId, mockMemoryId);
      expect(result).toEqual(expect.objectContaining({
        type: 'long-term',
        expiresAt: null,
      }));
    });

    it('should throw error when STM service not available', async () => {
      const serviceWithoutStm = new MemoryLtmService(prismaService);

      await expect(serviceWithoutStm.promote(mockUserId, mockMemoryId)).rejects.toThrow(
        LtmPromotionError
      );
    });

    it('should throw error when memory not found in STM', async () => {
      stmService.findById.mockResolvedValue(null);

      await expect(service.promote(mockUserId, mockMemoryId)).rejects.toThrow(
        LtmPromotionError
      );
    });

    it('should handle quota exceeded during promotion', async () => {
      stmService.findById.mockResolvedValue(mockStmMemory);
      
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          memory: {
            count: jest.fn().mockResolvedValue(DEFAULT_LTM_CONFIG.maxMemoriesPerUser),
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
      
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          memory: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue(mockMemory),
          },
        };
        return callback(mockTx);
      });
      
      prismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.promote(mockUserId, mockMemoryId);

      expect(result).toEqual(expect.objectContaining({
        type: 'long-term',
        expiresAt: null,
      }));
      // Should not throw even though STM deletion failed
    });
  });

  describe('user isolation', () => {
    it('should enforce user isolation in all operations', async () => {
      const user1 = 'user-1';
      const user2 = 'user-2';
      const memoryId = 'shared-memory-id';

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
});