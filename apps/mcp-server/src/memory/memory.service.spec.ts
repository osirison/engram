import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MemoryService } from './memory.service';
import {
  MemoryStmService,
  StmMemory,
  StmMemoryNotFoundError,
} from '@engram/memory-stm';
import {
  MemoryLtmService,
  LtmMemory,
  LtmMemoryNotFoundError,
} from '@engram/memory-ltm';

describe('MemoryService', () => {
  let service: MemoryService;
  let stmService: jest.Mocked<MemoryStmService>;
  let ltmService: jest.Mocked<MemoryLtmService>;

  const mockStmMemory: StmMemory = {
    id: 'stm-123',
    userId: 'user-1',
    content: 'Short-term memory content',
    metadata: { source: 'test' },
    tags: ['test', 'stm'],
    embedding: [],
    type: 'short-term',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    ttl: 86400,
    accessCount: 0,
  };

  const mockLtmMemory: LtmMemory = {
    id: 'ltm-456',
    userId: 'user-1',
    content: 'Long-term memory content',
    metadata: { source: 'test' },
    tags: ['test', 'ltm'],
    embedding: [],
    type: 'long-term',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };

  beforeEach(async () => {
    const mockStmService = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
    };

    const mockLtmService = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
      promote: jest.fn(),
      semanticSearch: jest.fn(),
      reindex: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        {
          provide: MemoryStmService,
          useValue: mockStmService,
        },
        {
          provide: MemoryLtmService,
          useValue: mockLtmService,
        },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    stmService = module.get<jest.Mocked<MemoryStmService>>(MemoryStmService);
    ltmService = module.get<jest.Mocked<MemoryLtmService>>(MemoryLtmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createMemory', () => {
    it('should create a short-term memory', async () => {
      stmService.create.mockResolvedValue(mockStmMemory);

      const result = await service.createMemory({
        userId: 'user-1',
        content: 'Short-term memory content',
        type: 'short-term',
        tags: ['test'],
        ttl: 86400,
      });

      expect(result).toEqual(mockStmMemory);
      expect(stmService.create).toHaveBeenCalledWith({
        userId: 'user-1',
        content: 'Short-term memory content',
        metadata: undefined,
        tags: ['test'],
        ttl: 86400,
      });
    });

    it('should create a long-term memory', async () => {
      ltmService.create.mockResolvedValue(mockLtmMemory);

      const result = await service.createMemory({
        userId: 'user-1',
        content: 'Long-term memory content',
        type: 'long-term',
        tags: ['test'],
      });

      expect(result).toEqual(mockLtmMemory);
      expect(ltmService.create).toHaveBeenCalledWith({
        userId: 'user-1',
        content: 'Long-term memory content',
        metadata: undefined,
        tags: ['test'],
      });
    });
  });

  describe('getMemory', () => {
    it('should return memory from STM if found', async () => {
      stmService.findById.mockResolvedValue(mockStmMemory);

      const result = await service.getMemory('user-1', 'stm-123');

      expect(result).toEqual(mockStmMemory);
      expect(stmService.findById).toHaveBeenCalledWith(
        'user-1',
        'stm-123',
        undefined,
        undefined,
      );
      expect(ltmService.get).not.toHaveBeenCalled();
    });

    it('should fallback to LTM if not found in STM', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('stm-123'),
      );
      ltmService.get.mockResolvedValue(mockLtmMemory);

      const result = await service.getMemory('user-1', 'ltm-456');

      expect(result).toEqual(mockLtmMemory);
      expect(stmService.findById).toHaveBeenCalledWith(
        'user-1',
        'ltm-456',
        undefined,
        undefined,
      );
      expect(ltmService.get).toHaveBeenCalledWith(
        'user-1',
        'ltm-456',
        undefined,
        undefined,
      );
    });

    it('should return null if memory not found in either store', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('not-found'),
      );
      ltmService.get.mockRejectedValue(new LtmMemoryNotFoundError('not-found'));

      const result = await service.getMemory('user-1', 'not-found');

      expect(result).toBeNull();
    });

    it('should rethrow non-StmMemoryNotFoundError from STM without calling LTM', async () => {
      const redisError = new Error('Redis connection failed');
      stmService.findById.mockRejectedValue(redisError);

      await expect(service.getMemory('user-1', 'stm-123')).rejects.toThrow(
        'Redis connection failed',
      );
      expect(ltmService.get).not.toHaveBeenCalled();
    });

    it('forwards a provided scope to both STM and LTM lookups', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('ltm-456'),
      );
      ltmService.get.mockResolvedValue(mockLtmMemory);

      await service.getMemory('user-1', 'ltm-456', 'agent:alpha');

      expect(stmService.findById).toHaveBeenCalledWith(
        'user-1',
        'ltm-456',
        undefined,
        'agent:alpha',
      );
      expect(ltmService.get).toHaveBeenCalledWith(
        'user-1',
        'ltm-456',
        undefined,
        'agent:alpha',
      );
    });
  });

  describe('listMemories', () => {
    it('should combine memories from both STM and LTM', async () => {
      stmService.list.mockResolvedValue({
        items: [mockStmMemory],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      ltmService.list.mockResolvedValue({
        items: [mockLtmMemory],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories('user-1', { limit: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(stmService.list).toHaveBeenCalledWith('user-1', { limit: 20 });
      expect(ltmService.list).toHaveBeenCalled();
    });

    it('should handle STM list errors gracefully', async () => {
      stmService.list.mockRejectedValue(new Error('STM error'));
      ltmService.list.mockResolvedValue({
        items: [mockLtmMemory],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories('user-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(mockLtmMemory);
    });

    it('should sort combined results by createdAt descending', async () => {
      const older = {
        ...mockStmMemory,
        id: 'older',
        createdAt: new Date('2024-01-01'),
      };
      const newer = {
        ...mockLtmMemory,
        id: 'newer',
        createdAt: new Date('2024-06-01'),
      };

      stmService.list.mockResolvedValue({
        items: [older],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      ltmService.list.mockResolvedValue({
        items: [newer],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories('user-1', { limit: 20 });

      expect(result.items[0]?.id).toBe('newer');
      expect(result.items[1]?.id).toBe('older');
    });

    it('should apply the limit after combining results from both stores', async () => {
      const ltmItems = Array.from({ length: 5 }, (_, i) => ({
        ...mockLtmMemory,
        id: `ltm-${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));

      stmService.list.mockResolvedValue({
        items: [],
        totalCount: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      ltmService.list.mockResolvedValue({
        items: ltmItems,
        totalCount: 5,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories('user-1', { limit: 3 });

      expect(result.items).toHaveLength(3);
      expect(result.hasNextPage).toBe(true);
    });

    it('should set startCursor and endCursor from paginated items', async () => {
      const first = {
        ...mockLtmMemory,
        id: 'first-id',
        createdAt: new Date('2024-06-01'),
      };
      const last = {
        ...mockLtmMemory,
        id: 'last-id',
        createdAt: new Date('2024-01-01'),
      };

      stmService.list.mockResolvedValue({
        items: [],
        totalCount: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      ltmService.list.mockResolvedValue({
        items: [first, last],
        totalCount: 2,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories('user-1');

      expect(result.startCursor).toBe('first-id');
      expect(result.endCursor).toBe('last-id');
    });

    it('should return empty cursors when no items are returned', async () => {
      stmService.list.mockResolvedValue({
        items: [],
        totalCount: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      ltmService.list.mockResolvedValue({
        items: [],
        totalCount: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories('user-1');

      expect(result.startCursor).toBeUndefined();
      expect(result.endCursor).toBeUndefined();
    });

    it('forwards the scope filter to BOTH the STM and LTM list calls', async () => {
      stmService.list.mockResolvedValue({
        items: [],
        totalCount: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      ltmService.list.mockResolvedValue({
        items: [],
        totalCount: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      await service.listMemories('user-1', { limit: 20, scope: 'agent:alpha' });

      // Regression: STM previously dropped the scope filter, leaking other
      // namespaces' short-term memories into a scoped list.
      expect(stmService.list).toHaveBeenCalledWith('user-1', {
        limit: 20,
        scope: 'agent:alpha',
      });
      expect(ltmService.list).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ scope: 'agent:alpha' }),
      );
    });
  });

  describe('updateMemory', () => {
    it('should update memory in STM if found there', async () => {
      stmService.findById.mockResolvedValue(mockStmMemory);
      stmService.update.mockResolvedValue({
        ...mockStmMemory,
        content: 'Updated content',
      });

      const result = await service.updateMemory('user-1', 'stm-123', {
        content: 'Updated content',
      });

      expect(result.content).toBe('Updated content');
      expect(stmService.update).toHaveBeenCalledWith(
        'user-1',
        'stm-123',
        {
          content: 'Updated content',
          metadata: undefined,
          tags: [],
          ttl: undefined,
        },
        undefined,
        undefined,
      );
    });

    it('should update memory in LTM if not found in STM', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('ltm-456'),
      );
      ltmService.get.mockResolvedValue(mockLtmMemory);
      ltmService.update.mockResolvedValue({
        ...mockLtmMemory,
        content: 'Updated content',
      });

      const result = await service.updateMemory('user-1', 'ltm-456', {
        content: 'Updated content',
      });

      expect(result.content).toBe('Updated content');
      expect(ltmService.update).toHaveBeenCalledWith(
        'user-1',
        'ltm-456',
        {
          content: 'Updated content',
          metadata: undefined,
          tags: undefined,
        },
        undefined,
        undefined,
      );
    });

    it('should throw NotFoundException if memory not found in either store', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('not-found'),
      );
      ltmService.get.mockResolvedValue(null);

      await expect(
        service.updateMemory('user-1', 'not-found', {
          content: 'Updated content',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should rethrow non-StmMemoryNotFoundError from STM without calling LTM', async () => {
      const redisError = new Error('Redis connection failed');
      stmService.findById.mockRejectedValue(redisError);

      await expect(
        service.updateMemory('user-1', 'stm-123', { content: 'new' }),
      ).rejects.toThrow('Redis connection failed');
      expect(ltmService.get).not.toHaveBeenCalled();
    });
  });

  describe('deleteMemory', () => {
    it('should delete from STM successfully', async () => {
      stmService.delete.mockResolvedValue(undefined);
      ltmService.delete.mockResolvedValue(false);

      const result = await service.deleteMemory('user-1', 'stm-123');

      expect(result).toBe(true);
      expect(stmService.delete).toHaveBeenCalledWith(
        'user-1',
        'stm-123',
        undefined,
        undefined,
      );
    });

    it('should delete from LTM successfully', async () => {
      stmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError('ltm-456'),
      );
      ltmService.delete.mockResolvedValue(true);

      const result = await service.deleteMemory('user-1', 'ltm-456');

      expect(result).toBe(true);
      expect(ltmService.delete).toHaveBeenCalledWith(
        'user-1',
        'ltm-456',
        undefined,
        undefined,
      );
    });

    it('should return false if not found in either store', async () => {
      stmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError('not-found'),
      );
      ltmService.delete.mockResolvedValue(false);

      const result = await service.deleteMemory('user-1', 'not-found');

      expect(result).toBe(false);
    });

    it('should delete from both stores when memory exists in both', async () => {
      stmService.delete.mockResolvedValue(undefined);
      ltmService.delete.mockResolvedValue(true);

      const result = await service.deleteMemory('user-1', 'dual-store-id');

      expect(stmService.delete).toHaveBeenCalledWith(
        'user-1',
        'dual-store-id',
        undefined,
        undefined,
      );
      expect(ltmService.delete).toHaveBeenCalledWith(
        'user-1',
        'dual-store-id',
        undefined,
        undefined,
      );
      expect(result).toBe(true);
    });

    it('should rethrow non-StmMemoryNotFoundError from STM without calling LTM', async () => {
      const redisError = new Error('Redis connection failed');
      stmService.delete.mockRejectedValue(redisError);

      await expect(service.deleteMemory('user-1', 'stm-123')).rejects.toThrow(
        'Redis connection failed',
      );
      expect(ltmService.delete).not.toHaveBeenCalled();
    });

    it('should rethrow non-LtmMemoryNotFoundError from LTM', async () => {
      stmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError('ltm-456'),
      );
      const dbError = new Error('Database connection failed');
      ltmService.delete.mockRejectedValue(dbError);

      await expect(service.deleteMemory('user-1', 'ltm-456')).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('forwards a provided scope to both STM and LTM deletes', async () => {
      stmService.delete.mockResolvedValue(undefined);
      ltmService.delete.mockResolvedValue(true);

      await service.deleteMemory('user-1', 'mem-1', 'agent:alpha');

      expect(stmService.delete).toHaveBeenCalledWith(
        'user-1',
        'mem-1',
        undefined,
        'agent:alpha',
      );
      expect(ltmService.delete).toHaveBeenCalledWith(
        'user-1',
        'mem-1',
        undefined,
        'agent:alpha',
      );
    });
  });

  describe('promoteMemory', () => {
    it('should promote memory from STM to LTM', async () => {
      ltmService.promote.mockResolvedValue(mockLtmMemory);

      const result = await service.promoteMemory('user-1', 'stm-123');

      expect(result).toEqual(mockLtmMemory);
      expect(ltmService.promote).toHaveBeenCalledWith(
        'user-1',
        'stm-123',
        undefined,
        undefined,
      );
    });
  });

  describe('recall', () => {
    it('should delegate semantic recall to the LTM service', async () => {
      const semanticResult = [{ memory: mockLtmMemory, score: 0.87 }];
      ltmService.semanticSearch.mockResolvedValue(semanticResult);

      const result = await service.recall('user-1', 'find my notes', {
        limit: 5,
        scope: 'project-a',
        tags: ['notes'],
      });

      expect(result).toEqual(semanticResult);
      expect(ltmService.semanticSearch).toHaveBeenCalledWith(
        'user-1',
        'find my notes',
        { limit: 5, scope: 'project-a', tags: ['notes'] },
      );
    });

    it('should default options when none are provided', async () => {
      ltmService.semanticSearch.mockResolvedValue([]);

      const result = await service.recall('user-1', 'query');

      expect(result).toEqual([]);
      expect(ltmService.semanticSearch).toHaveBeenCalledWith(
        'user-1',
        'query',
        {
          limit: undefined,
          scope: undefined,
          tags: undefined,
          createdFrom: undefined,
          createdTo: undefined,
        },
      );
    });

    it('should forward date-range filters to the LTM service', async () => {
      const createdFrom = new Date('2025-01-01T00:00:00Z');
      const createdTo = new Date('2025-06-01T00:00:00Z');
      ltmService.semanticSearch.mockResolvedValue([]);

      await service.recall('user-1', 'query', { createdFrom, createdTo });

      expect(ltmService.semanticSearch).toHaveBeenCalledWith(
        'user-1',
        'query',
        expect.objectContaining({ createdFrom, createdTo }),
      );
    });
  });

  describe('reindex', () => {
    it('should delegate reindex to the LTM service', async () => {
      const summary = {
        processed: 3,
        indexed: 3,
        skipped: 0,
        failed: 0,
        cursor: null,
      };

      ltmService.reindex.mockResolvedValue(summary);

      const result = await service.reindex({ userId: 'user-1', batchSize: 50 });

      expect(result).toEqual(summary);
      expect(ltmService.reindex).toHaveBeenCalledWith({
        userId: 'user-1',
        batchSize: 50,
      });
    });

    it('should default to all users when no options are provided', async () => {
      const summary = {
        processed: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        cursor: null,
      };

      ltmService.reindex.mockResolvedValue(summary);

      const result = await service.reindex();

      expect(result).toEqual(summary);
      expect(ltmService.reindex).toHaveBeenCalledWith({});
    });

    it('should forward the recreate flag to the LTM service', async () => {
      const summary = {
        processed: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        cursor: null,
      };
      ltmService.reindex.mockResolvedValue(summary);

      await service.reindex({ recreate: true });

      expect(ltmService.reindex).toHaveBeenCalledWith({ recreate: true });
    });
  });
});
