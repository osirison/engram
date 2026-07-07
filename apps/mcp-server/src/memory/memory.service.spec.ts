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
  LtmMemoryQuotaExceededError,
  DEFAULT_LTM_CONFIG,
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
    version: 1,
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
    version: 1,
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
      reembed: jest.fn(),
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

    it('propagates LtmMemoryQuotaExceededError from LTM create unchanged', async () => {
      const quotaError = new LtmMemoryQuotaExceededError(
        'user-1',
        DEFAULT_LTM_CONFIG.maxMemoriesPerUser,
      );
      ltmService.create.mockRejectedValue(quotaError);

      await expect(
        service.createMemory({
          userId: 'user-1',
          content: 'over quota',
          type: 'long-term',
        }),
      ).rejects.toBe(quotaError);
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
    it('type=short-term queries STM only and passes the SCAN cursor through', async () => {
      stmService.list.mockResolvedValue({
        items: [mockStmMemory],
        totalCount: 1,
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: '0',
        endCursor: '42',
      });

      const result = await service.listMemories('user-1', {
        type: 'short-term',
        limit: 20,
        cursor: '17',
        scope: 'agent:alpha',
        tags: ['x'],
      });

      // STM-only: LTM is never touched, and the Redis SCAN cursor is forwarded.
      expect(ltmService.list).not.toHaveBeenCalled();
      expect(stmService.list).toHaveBeenCalledWith('user-1', {
        limit: 20,
        cursor: '17',
        scope: 'agent:alpha',
        tags: ['x'],
      });
      expect(result.items).toEqual([mockStmMemory]);
      expect(result.endCursor).toBe('42');
      expect(result.hasNextPage).toBe(true);
    });

    it('type=long-term queries LTM only and never merges STM', async () => {
      ltmService.list.mockResolvedValue({
        items: [mockLtmMemory],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories('user-1', {
        type: 'long-term',
        limit: 20,
      });

      expect(stmService.list).not.toHaveBeenCalled();
      expect(ltmService.list).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ limit: 20 }),
      );
      expect(result.items).toEqual([mockLtmMemory]);
    });

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

  describe('bulkDeleteMemories (WP2 T6)', () => {
    it('reports per-item results across an STM+LTM mix with partial failures', async () => {
      // stm-1 lives in STM; ltm-1 in LTM; gone-1 in neither (not-found).
      stmService.delete.mockImplementation((_u: string, id: string) =>
        id === 'stm-1'
          ? Promise.resolve() // deleted from STM
          : Promise.reject(new StmMemoryNotFoundError(id)),
      );
      ltmService.delete.mockImplementation((_u: string, id: string) =>
        Promise.resolve(id === 'ltm-1'),
      );

      const result = await service.bulkDeleteMemories('user-1', [
        'stm-1',
        'ltm-1',
        'gone-1',
      ]);

      expect(result.deleted.sort()).toEqual(['ltm-1', 'stm-1']);
      expect(result.failed).toEqual([{ id: 'gone-1', reason: 'not-found' }]);
    });

    it('still counts a row as deleted when only vector cleanup failed (Postgres is truth)', async () => {
      // deleteMemory resolves true even if the vector-store removal failed — the
      // Postgres row is gone. Model that by returning true from ltm.delete.
      stmService.delete.mockRejectedValue(new StmMemoryNotFoundError('x'));
      ltmService.delete.mockResolvedValue(true);

      const result = await service.bulkDeleteMemories('user-1', ['a', 'b']);
      expect(result.deleted.sort()).toEqual(['a', 'b']);
      expect(result.failed).toEqual([]);
    });

    it('does not abort the batch when one id throws a hard error', async () => {
      stmService.delete.mockRejectedValue(new StmMemoryNotFoundError('x'));
      ltmService.delete.mockImplementation((_u: string, id: string) =>
        id === 'boom'
          ? Promise.reject(new Error('db exploded'))
          : Promise.resolve(true),
      );

      const result = await service.bulkDeleteMemories('user-1', [
        'ok-1',
        'boom',
        'ok-2',
      ]);
      expect(result.deleted.sort()).toEqual(['ok-1', 'ok-2']);
      expect(result.failed).toEqual([{ id: 'boom', reason: 'db exploded' }]);
    });

    it('de-duplicates repeated ids', async () => {
      stmService.delete.mockRejectedValue(new StmMemoryNotFoundError('x'));
      ltmService.delete.mockResolvedValue(true);

      const result = await service.bulkDeleteMemories('user-1', [
        'a',
        'a',
        'a',
      ]);
      expect(result.deleted).toEqual(['a']);
      expect(ltmService.delete).toHaveBeenCalledTimes(1);
    });

    it('caps in-flight deletions at the bounded concurrency of 5', async () => {
      // Block every per-item delete on a manual resolver so we can observe how
      // many run at once. With 12 ids and a cap of 5, at most 5 are ever
      // in-flight (runConcurrent worker pool — WP2 T6/D9).
      let inFlight = 0;
      let maxInFlight = 0;
      const resolvers: Array<() => void> = [];
      const deleteSpy = jest.spyOn(service, 'deleteMemory').mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            resolvers.push(() => {
              inFlight--;
              resolve(true);
            });
          }),
      );

      const ids = Array.from({ length: 12 }, (_, i) => `id-${i}`);
      const pending = service.bulkDeleteMemories('user-1', ids);

      // Let the first wave of workers register.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(maxInFlight).toBe(5);

      // Drain in rounds until the batch completes.
      while (resolvers.length > 0) {
        resolvers.splice(0).forEach((release) => release());
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }

      const result = await pending;
      expect(result.deleted).toHaveLength(12);
      expect(maxInFlight).toBe(5);
      deleteSpy.mockRestore();
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

    it('propagates LtmMemoryQuotaExceededError from LTM promote unchanged', async () => {
      const quotaError = new LtmMemoryQuotaExceededError(
        'user-1',
        DEFAULT_LTM_CONFIG.maxMemoriesPerUser,
      );
      ltmService.promote.mockRejectedValue(quotaError);

      await expect(service.promoteMemory('user-1', 'stm-123')).rejects.toBe(
        quotaError,
      );
    });
  });

  describe('reembedMemory (WP2 T7)', () => {
    it('delegates to LTM reembed when the id is not a live STM memory', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('ltm-1'),
      );
      ltmService.reembed.mockResolvedValue(mockLtmMemory);

      const result = await service.reembedMemory('user-1', 'ltm-1');

      expect(result).toEqual(mockLtmMemory);
      expect(ltmService.reembed).toHaveBeenCalledWith(
        'user-1',
        'ltm-1',
        undefined,
        undefined,
      );
    });

    it('rejects an STM id with a clear error and never calls LTM reembed', async () => {
      // The id resolves in STM — STM is not vector-indexed, so reembed is invalid.
      stmService.findById.mockResolvedValue(mockStmMemory);

      await expect(service.reembedMemory('user-1', 'stm-123')).rejects.toThrow(
        /short-term and is not vector-indexed/,
      );
      expect(ltmService.reembed).not.toHaveBeenCalled();
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

  describe('atomic LTM quota wiring (#203)', () => {
    // End-to-end through the seam: a REAL MemoryLtmService (prisma mocked)
    // behind MemoryService, exercising the advisory-lock quota transaction.
    const wiredUserId = 'cldx4k8xp000108l83h4y8v2q';

    type PrismaMock = {
      memory: {
        count: jest.Mock;
        create: jest.Mock;
        findFirst: jest.Mock;
      };
      $executeRaw: jest.Mock;
      $transaction: jest.Mock;
    };

    async function buildWiredService(): Promise<{
      wired: MemoryService;
      prisma: PrismaMock;
    }> {
      const prisma: PrismaMock = {
        memory: {
          count: jest.fn(),
          create: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
        $transaction: jest.fn(),
      };
      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
      );

      const realLtmService = new MemoryLtmService(prisma as never);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MemoryService,
          { provide: MemoryStmService, useValue: { create: jest.fn() } },
          { provide: MemoryLtmService, useValue: realLtmService },
        ],
      }).compile();

      return { wired: module.get<MemoryService>(MemoryService), prisma };
    }

    it('creates through the advisory-lock transaction when under quota', async () => {
      const { wired, prisma } = await buildWiredService();
      prisma.memory.count.mockResolvedValue(0);
      prisma.memory.create.mockResolvedValue({
        id: 'cldx4k8xp000208l84b5c9w3r',
        userId: wiredUserId,
        organizationId: null,
        scope: null,
        content: 'wired create',
        metadata: {},
        tags: [],
        type: 'long-term',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        embedding: [],
      });

      const result = await wired.createMemory({
        userId: wiredUserId,
        content: 'wired create',
        type: 'long-term',
      });

      expect(result.type).toBe('long-term');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Tagged-template call shape: [templateStrings, ...boundParams]
      const lockCall = prisma.$executeRaw.mock.calls[0] as [
        ReadonlyArray<string>,
        number,
        string,
      ];
      expect(lockCall[0].join('?')).toContain('pg_advisory_xact_lock');
      expect(lockCall[2]).toBe(wiredUserId);
    });

    it('surfaces the friendly quota error when the transaction loses the race', async () => {
      const { wired, prisma } = await buildWiredService();
      prisma.memory.count
        .mockResolvedValueOnce(0) // fast-fail pre-check passes
        .mockResolvedValueOnce(DEFAULT_LTM_CONFIG.maxMemoriesPerUser); // in-tx count sees the cap

      await expect(
        wired.createMemory({
          userId: wiredUserId,
          content: 'lost the race',
          type: 'long-term',
        }),
      ).rejects.toMatchObject({
        name: 'LtmMemoryQuotaExceededError',
        message: `Long-term memory quota exceeded for user ${wiredUserId}. Limit: ${DEFAULT_LTM_CONFIG.maxMemoriesPerUser} memories`,
      });
      expect(prisma.memory.create).not.toHaveBeenCalled();
    });
  });
});
