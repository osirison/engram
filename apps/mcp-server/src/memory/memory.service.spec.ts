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
    type: 'short-term',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    ttl: 86400,
  };

  const mockLtmMemory: LtmMemory = {
    id: 'ltm-456',
    userId: 'user-1',
    content: 'Long-term memory content',
    metadata: { source: 'test' },
    tags: ['test', 'ltm'],
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
    stmService = module.get(MemoryStmService);
    ltmService = module.get(MemoryLtmService);
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
      expect(stmService.findById).toHaveBeenCalledWith('user-1', 'stm-123');
      expect(ltmService.get).not.toHaveBeenCalled();
    });

    it('should fallback to LTM if not found in STM', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('stm-123'),
      );
      ltmService.get.mockResolvedValue(mockLtmMemory);

      const result = await service.getMemory('user-1', 'ltm-456');

      expect(result).toEqual(mockLtmMemory);
      expect(stmService.findById).toHaveBeenCalledWith('user-1', 'ltm-456');
      expect(ltmService.get).toHaveBeenCalledWith('user-1', 'ltm-456');
    });

    it('should return null if memory not found in either store', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError('not-found'),
      );
      ltmService.get.mockRejectedValue(
        new LtmMemoryNotFoundError('not-found'),
      );

      const result = await service.getMemory('user-1', 'not-found');

      expect(result).toBeNull();
    });
  });

  describe('listMemories', () => {
    it('should combine memories from both STM and LTM', async () => {
      stmService.list.mockResolvedValue([mockStmMemory]);
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
      expect(stmService.update).toHaveBeenCalledWith('user-1', 'stm-123', {
        content: 'Updated content',
        metadata: undefined,
        tags: [],
        ttl: undefined,
      });
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
      expect(ltmService.update).toHaveBeenCalledWith('user-1', 'ltm-456', {
        content: 'Updated content',
        metadata: undefined,
        tags: undefined,
      });
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
  });

  describe('deleteMemory', () => {
    it('should delete from STM successfully', async () => {
      stmService.delete.mockResolvedValue(undefined);
      ltmService.delete.mockResolvedValue(false);

      const result = await service.deleteMemory('user-1', 'stm-123');

      expect(result).toBe(true);
      expect(stmService.delete).toHaveBeenCalledWith('user-1', 'stm-123');
    });

    it('should delete from LTM successfully', async () => {
      stmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError('ltm-456'),
      );
      ltmService.delete.mockResolvedValue(true);

      const result = await service.deleteMemory('user-1', 'ltm-456');

      expect(result).toBe(true);
      expect(ltmService.delete).toHaveBeenCalledWith('user-1', 'ltm-456');
    });

    it('should return false if not found in either store', async () => {
      stmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError('not-found'),
      );
      ltmService.delete.mockResolvedValue(false);

      const result = await service.deleteMemory('user-1', 'not-found');

      expect(result).toBe(false);
    });
  });

  describe('promoteMemory', () => {
    it('should promote memory from STM to LTM', async () => {
      ltmService.promote.mockResolvedValue(mockLtmMemory);

      const result = await service.promoteMemory('user-1', 'stm-123');

      expect(result).toEqual(mockLtmMemory);
      expect(ltmService.promote).toHaveBeenCalledWith('user-1', 'stm-123');
    });
  });
});
