import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { MemoryService } from '../src/memory/memory.service';
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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const TEST_USER_ID = 'int-test-user-01';
const STM_ID = 'stm-int-001';
const LTM_ID = 'ltm-int-001';

const makeStmMemory = (overrides: Partial<StmMemory> = {}): StmMemory => ({
  id: STM_ID,
  userId: TEST_USER_ID,
  content: 'STM integration test content',
  metadata: null,
  tags: ['integration', 'stm'],
  embedding: [],
  type: 'short-term',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date(Date.now() + 3600 * 1000),
  ttl: 3600,
  ...overrides,
});

const makeLtmMemory = (overrides: Partial<LtmMemory> = {}): LtmMemory => ({
  id: LTM_ID,
  userId: TEST_USER_ID,
  content: 'LTM integration test content',
  metadata: null,
  tags: ['integration', 'ltm'],
  embedding: [],
  type: 'long-term',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
  ...overrides,
});

type PaginatedFixture<T> = {
  items: T[];
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

const emptyPaginated = <T>(): PaginatedFixture<T> => ({
  items: [] as T[],
  totalCount: 0,
  hasNextPage: false,
  hasPreviousPage: false,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('MemoryService Integration', () => {
  let service: MemoryService;
  let stmService: jest.Mocked<MemoryStmService>;
  let ltmService: jest.Mocked<MemoryLtmService>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  beforeEach(async () => {
    const stmMock: Partial<jest.Mocked<MemoryStmService>> = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
    };

    const ltmMock: Partial<jest.Mocked<MemoryLtmService>> = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
      promote: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: MemoryStmService, useValue: stmMock },
        { provide: MemoryLtmService, useValue: ltmMock },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    stmService = module.get(MemoryStmService);
    ltmService = module.get(MemoryLtmService);
  });

  // -------------------------------------------------------------------------
  // STM lifecycle
  // -------------------------------------------------------------------------
  describe('STM memory lifecycle', () => {
    it('should route createMemory to STM service for short-term type', async () => {
      const memory = makeStmMemory();
      stmService.create.mockResolvedValue(memory);

      const result = await service.createMemory({
        userId: TEST_USER_ID,
        content: 'STM content',
        type: 'short-term',
        tags: ['integration'],
        ttl: 3600,
      });

      expect(result).toEqual(memory);
      expect(stmService.create).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        content: 'STM content',
        metadata: undefined,
        tags: ['integration'],
        ttl: 3600,
      });
      expect(ltmService.create).not.toHaveBeenCalled();
    });

    it('should retrieve STM memory directly without checking LTM', async () => {
      const memory = makeStmMemory();
      stmService.findById.mockResolvedValue(memory);

      const result = await service.getMemory(TEST_USER_ID, STM_ID);

      expect(result).toEqual(memory);
      expect(stmService.findById).toHaveBeenCalledWith(TEST_USER_ID, STM_ID);
      expect(ltmService.get).not.toHaveBeenCalled();
    });

    it('should update STM memory when found in STM', async () => {
      const original = makeStmMemory();
      const updated = makeStmMemory({ content: 'Updated STM content' });
      stmService.findById.mockResolvedValue(original);
      stmService.update.mockResolvedValue(updated);

      const result = await service.updateMemory(TEST_USER_ID, STM_ID, {
        content: 'Updated STM content',
      });

      expect(result).toEqual(updated);
      expect(stmService.update).toHaveBeenCalled();
      expect(ltmService.update).not.toHaveBeenCalled();
    });

    it('should delete STM memory and return true', async () => {
      stmService.delete.mockResolvedValue(undefined);
      ltmService.delete.mockResolvedValue(false);

      const result = await service.deleteMemory(TEST_USER_ID, STM_ID);

      expect(result).toBe(true);
      expect(stmService.delete).toHaveBeenCalledWith(TEST_USER_ID, STM_ID);
    });
  });

  // -------------------------------------------------------------------------
  // LTM lifecycle
  // -------------------------------------------------------------------------
  describe('LTM memory lifecycle', () => {
    it('should route createMemory to LTM service for long-term type', async () => {
      const memory = makeLtmMemory();
      ltmService.create.mockResolvedValue(memory);

      const result = await service.createMemory({
        userId: TEST_USER_ID,
        content: 'LTM content',
        type: 'long-term',
        tags: ['important'],
      });

      expect(result).toEqual(memory);
      expect(ltmService.create).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        content: 'LTM content',
        metadata: undefined,
        tags: ['important'],
      });
      expect(stmService.create).not.toHaveBeenCalled();
    });

    it('should fall back to LTM when memory not found in STM', async () => {
      const memory = makeLtmMemory();
      stmService.findById.mockRejectedValue(new StmMemoryNotFoundError(LTM_ID));
      ltmService.get.mockResolvedValue(memory);

      const result = await service.getMemory(TEST_USER_ID, LTM_ID);

      expect(result).toEqual(memory);
      expect(stmService.findById).toHaveBeenCalledWith(TEST_USER_ID, LTM_ID);
      expect(ltmService.get).toHaveBeenCalledWith(TEST_USER_ID, LTM_ID);
    });

    it('should update LTM memory when not found in STM', async () => {
      const memory = makeLtmMemory();
      const updated = makeLtmMemory({ content: 'Updated LTM content' });
      stmService.findById.mockRejectedValue(new StmMemoryNotFoundError(LTM_ID));
      ltmService.get.mockResolvedValue(memory);
      ltmService.update.mockResolvedValue(updated);

      const result = await service.updateMemory(TEST_USER_ID, LTM_ID, {
        content: 'Updated LTM content',
      });

      expect(result.content).toBe('Updated LTM content');
      expect(ltmService.update).toHaveBeenCalled();
    });

    it('should delete LTM memory and return true', async () => {
      stmService.delete.mockRejectedValue(new StmMemoryNotFoundError(LTM_ID));
      ltmService.delete.mockResolvedValue(true);

      const result = await service.deleteMemory(TEST_USER_ID, LTM_ID);

      expect(result).toBe(true);
      expect(ltmService.delete).toHaveBeenCalledWith(TEST_USER_ID, LTM_ID);
    });
  });

  // -------------------------------------------------------------------------
  // Not-found and error propagation
  // -------------------------------------------------------------------------
  describe('not-found and error propagation', () => {
    it('should return null when memory not found in either store', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('unknown-id'),
      );
      ltmService.get.mockRejectedValue(
        new LtmMemoryNotFoundError('unknown-id'),
      );

      const result = await service.getMemory(TEST_USER_ID, 'unknown-id');

      expect(result).toBeNull();
    });

    it('should return null when LTM get returns null', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('unknown-id'),
      );
      ltmService.get.mockResolvedValue(null);

      const result = await service.getMemory(TEST_USER_ID, 'unknown-id');

      expect(result).toBeNull();
    });

    it('should throw NotFoundException when updating non-existent memory', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('unknown-id'),
      );
      ltmService.get.mockResolvedValue(null);

      await expect(
        service.updateMemory(TEST_USER_ID, 'unknown-id', {
          content: 'New content',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return false when deleting memory not found in either store', async () => {
      stmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError('unknown-id'),
      );
      ltmService.delete.mockResolvedValue(false);

      const result = await service.deleteMemory(TEST_USER_ID, 'unknown-id');

      expect(result).toBe(false);
    });

    it('should propagate non-not-found STM errors on getMemory', async () => {
      stmService.findById.mockRejectedValue(
        new Error('Redis connection error'),
      );

      await expect(service.getMemory(TEST_USER_ID, STM_ID)).rejects.toThrow(
        'Redis connection error',
      );
    });

    it('should propagate non-not-found LTM errors on getMemory', async () => {
      stmService.findById.mockRejectedValue(new StmMemoryNotFoundError(LTM_ID));
      ltmService.get.mockRejectedValue(new Error('Database unreachable'));

      await expect(service.getMemory(TEST_USER_ID, LTM_ID)).rejects.toThrow(
        'Database unreachable',
      );
    });

    it('should propagate non-not-found STM errors on deleteMemory', async () => {
      stmService.delete.mockRejectedValue(new Error('Redis connection error'));

      await expect(service.deleteMemory(TEST_USER_ID, STM_ID)).rejects.toThrow(
        'Redis connection error',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Combined listing
  // -------------------------------------------------------------------------
  describe('listMemories — combined STM + LTM', () => {
    it('should combine and sort memories newest-first', async () => {
      const stmMemory = makeStmMemory({
        id: 'stm-1',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      });
      const ltmMemory = makeLtmMemory({
        id: 'ltm-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      stmService.list.mockResolvedValue({
        items: [stmMemory],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      ltmService.list.mockResolvedValue({
        items: [ltmMemory],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories(TEST_USER_ID);

      expect(result.items).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      // STM memory is newer — should appear first
      expect(result.items[0]?.id).toBe('stm-1');
      expect(result.items[1]?.id).toBe('ltm-1');
    });

    it('should return empty result when both stores are empty', async () => {
      stmService.list.mockResolvedValue(emptyPaginated<StmMemory>());
      ltmService.list.mockResolvedValue(emptyPaginated<LtmMemory>());

      const result = await service.listMemories(TEST_USER_ID);

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.hasNextPage).toBe(false);
    });

    it('should still return LTM results when STM list fails', async () => {
      const ltmMemory = makeLtmMemory();
      stmService.list.mockRejectedValue(new Error('STM list failed'));
      ltmService.list.mockResolvedValue({
        items: [ltmMemory],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories(TEST_USER_ID);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(LTM_ID);
    });

    it('should respect the limit option', async () => {
      const stmMemories = Array.from({ length: 5 }, (_, i) =>
        makeStmMemory({ id: `stm-${i}`, createdAt: new Date(Date.now() - i) }),
      );
      const ltmMemories = Array.from({ length: 5 }, (_, i) =>
        makeLtmMemory({
          id: `ltm-${i}`,
          createdAt: new Date(Date.now() - i - 1000),
        }),
      );

      stmService.list.mockResolvedValue({
        items: stmMemories,
        totalCount: 5,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      ltmService.list.mockResolvedValue({
        items: ltmMemories,
        totalCount: 5,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const result = await service.listMemories(TEST_USER_ID, { limit: 3 });

      expect(result.items).toHaveLength(3);
    });
  });
});
