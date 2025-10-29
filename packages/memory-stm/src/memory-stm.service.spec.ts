import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStmService } from './memory-stm.service';
import {
  StmMemoryNotFoundError,
  StmMemoryExpiredError,
  StmTtlValidationError,
  CreateStmMemoryData,
  UpdateStmMemoryData,
} from './types';

// Mock Redis service
const mockRedisService = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  delMany: vi.fn(),
  ttl: vi.fn(),
  exists: vi.fn(),
  scan: vi.fn(),
  pipeline: vi.fn(() => ({
    get: vi.fn().mockReturnThis(),
    exec: vi.fn(),
  })),
};

describe('MemoryStmService', () => {
  let service: MemoryStmService;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create service directly with mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new MemoryStmService(mockRedisService as any);
  });

  describe('create', () => {
    it('should create a new STM memory', async () => {
      const input: CreateStmMemoryData = {
        userId: 'clq1234567890abcdef1234', // Valid CUID
        content: 'Test memory content',
        metadata: { type: 'note' },
        tags: ['test'],
        ttl: 3600, // 1 hour
      };

      mockRedisService.set.mockResolvedValue('OK');

      const result = await service.create(input);

      expect(result).toMatchObject({
        userId: input.userId,
        content: input.content,
        metadata: input.metadata,
        tags: input.tags,
        type: 'short-term' as const,
        ttl: input.ttl,
      });

      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('memory:stm:clq1234567890abcdef1234:'),
        expect.stringContaining('"content":"Test memory content"'),
        3600
      );
    });

    it('should create memory with default TTL when not provided', async () => {
      const input: CreateStmMemoryData = {
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
      };

      mockRedisService.set.mockResolvedValue('OK');

      const result = await service.create(input);

      expect(result.ttl).toBe(86400); // Default 24 hours
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        86400
      );
    });

    it('should throw error for invalid TTL', async () => {
      const input: CreateStmMemoryData = {
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        ttl: 30, // Below minimum (60 seconds)
      };

      // Zod validation throws ZodError, not our custom error
      await expect(service.create(input)).rejects.toThrow('TTL must be at least 1 minute');
    });
  });

  describe('findById', () => {
    it('should retrieve an existing memory', async () => {
      const memoryData = {
        id: 'mem123',
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        metadata: null,
        tags: [],
        type: 'short-term' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        ttl: 3600,
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(memoryData));

      const result = await service.findById('clq1234567890abcdef1234', 'mem123');

      expect(result).toMatchObject({
        id: 'mem123',
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        type: 'short-term' as const,
      });
      expect(mockRedisService.get).toHaveBeenCalledWith('memory:stm:clq1234567890abcdef1234:mem123');
    });

    it('should throw error when memory not found', async () => {
      mockRedisService.get.mockResolvedValue(null);

      await expect(service.findById('clq1234567890abcdef1234', 'nonexistent')).rejects.toThrow(
        StmMemoryNotFoundError
      );
    });

    it('should throw error and cleanup when memory expired', async () => {
      const expiredMemoryData = {
        id: 'mem123',
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        metadata: null,
        tags: [],
        type: 'short-term' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago (expired)
        ttl: 3600,
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(expiredMemoryData));
      mockRedisService.del.mockResolvedValue(1);

      await expect(service.findById('clq1234567890abcdef1234', 'mem123')).rejects.toThrow(
        StmMemoryExpiredError
      );
      expect(mockRedisService.del).toHaveBeenCalledWith('memory:stm:clq1234567890abcdef1234:mem123');
    });
  });

  describe('update', () => {
    it('should update an existing memory', async () => {
      const existingMemory = {
        id: 'mem123',
        userId: 'clq1234567890abcdef1234',
        content: 'Original content',
        metadata: { type: 'note' },
        tags: ['original'],
        type: 'short-term' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        ttl: 3600,
      };

      const updateInput: UpdateStmMemoryData = {
        content: 'Updated content',
        tags: ['updated'],
        ttl: 7200, // 2 hours
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(existingMemory));
      mockRedisService.set.mockResolvedValue('OK');

      // Add small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 2));

      const result = await service.update('clq1234567890abcdef1234', 'mem123', updateInput);

      expect(result.content).toBe('Updated content');
      expect(result.tags).toEqual(['updated']);
      expect(result.ttl).toBe(7200);
      expect(result.updatedAt.getTime()).toBeGreaterThan(existingMemory.updatedAt.getTime());
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'memory:stm:clq1234567890abcdef1234:mem123',
        expect.stringContaining('"content":"Updated content"'),
        7200
      );
    });

    it('should preserve existing fields when not updated', async () => {
      const existingMemory = {
        id: 'mem123',
        userId: 'clq1234567890abcdef1234',
        content: 'Original content',
        metadata: { type: 'note' },
        tags: ['original'],
        type: 'short-term' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        ttl: 3600,
      };

      const updateInput: UpdateStmMemoryData = {
        content: 'Updated content',
        tags: ['updated'],
        // No TTL update - should preserve existing
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(existingMemory));
      mockRedisService.set.mockResolvedValue('OK');

      const result = await service.update('clq1234567890abcdef1234', 'mem123', updateInput);

      expect(result.content).toBe('Updated content');
      expect(result.metadata).toEqual({ type: 'note' }); // Preserved
      expect(result.ttl).toBe(3600); // Preserved
    });
  });

  describe('delete', () => {
    it('should delete an existing memory', async () => {
      mockRedisService.del.mockResolvedValue(1);

      await service.delete('clq1234567890abcdef1234', 'mem123');

      expect(mockRedisService.del).toHaveBeenCalledWith('memory:stm:clq1234567890abcdef1234:mem123');
    });

    it('should throw error when memory not found', async () => {
      mockRedisService.del.mockResolvedValue(0);

      await expect(service.delete('clq1234567890abcdef1234', 'nonexistent')).rejects.toThrow(
        StmMemoryNotFoundError
      );
    });
  });

  describe('getTtl', () => {
    it('should return remaining TTL', async () => {
      mockRedisService.ttl.mockResolvedValue(1800); // 30 minutes

      const result = await service.getTtl('clq1234567890abcdef1234', 'mem123');

      expect(result).toBe(1800);
      expect(mockRedisService.ttl).toHaveBeenCalledWith('memory:stm:clq1234567890abcdef1234:mem123');
    });

    it('should throw error when memory not found', async () => {
      mockRedisService.ttl.mockResolvedValue(-2); // Key doesn't exist

      await expect(service.getTtl('clq1234567890abcdef1234', 'nonexistent')).rejects.toThrow(
        StmMemoryNotFoundError
      );
    });

    it('should return 0 when key has no expiration', async () => {
      mockRedisService.ttl.mockResolvedValue(-1); // Key exists but no TTL

      const result = await service.getTtl('clq1234567890abcdef1234', 'mem123');

      expect(result).toBe(0);
    });
  });

  describe('extendTtl', () => {
    it('should extend TTL for a memory', async () => {
      const existingMemory = {
        id: 'mem123',
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        metadata: null,
        tags: ['test'],
        type: 'short-term' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        ttl: 3600,
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(existingMemory));
      mockRedisService.ttl.mockResolvedValue(600); // 10 minutes remaining
      mockRedisService.set.mockResolvedValue('OK');

      const result = await service.extendTtl('clq1234567890abcdef1234', 'mem123', 1800); // Add 30 minutes

      expect(result.ttl).toBe(2400); // 10 min remaining (600) + 30 min added (1800) = 2400
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'memory:stm:clq1234567890abcdef1234:mem123',
        expect.any(String),
        2400
      );
    });

    it('should throw error for invalid extended TTL', async () => {
      const existingMemory = {
        id: 'mem123',
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        metadata: null,
        tags: ['test'],
        type: 'short-term' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        ttl: 3600,
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(existingMemory));
      mockRedisService.ttl.mockResolvedValue(604000); // Nearly 7 days remaining (604000 seconds)
      
      // Try to extend by 1 day (86400) which would exceed max TTL (604000 + 86400 = 690400 > 604800)
      await expect(service.extendTtl('clq1234567890abcdef1234', 'mem123', 86400)).rejects.toThrow(
        StmTtlValidationError
      );
    });
  });

  describe('list', () => {
    it('should list all memories for a user', async () => {
      const memory1 = {
        id: 'mem1',
        userId: 'clq1234567890abcdef1234',
        content: 'Memory 1',
        metadata: null,
        tags: ['test'],
        type: 'short-term' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        ttl: 3600,
      };

      const memory2 = {
        id: 'mem2',
        userId: 'clq1234567890abcdef1234',
        content: 'Memory 2',
        metadata: null,
        tags: ['test'],
        type: 'short-term' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        ttl: 3600,
      };

      // Mock for list operation
      mockRedisService.scan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['memory:stm:clq1234567890abcdef1234:mem1', 'memory:stm:clq1234567890abcdef1234:mem2'],
      });

      const mockPipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, JSON.stringify(memory1)],
          [null, JSON.stringify(memory2)],
        ]),
      };
      mockRedisService.pipeline.mockReturnValue(mockPipeline);

      // Mock for count operation (called by list)
      mockRedisService.scan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['memory:stm:clq1234567890abcdef1234:mem1', 'memory:stm:clq1234567890abcdef1234:mem2'],
      });

      const result = await service.list('clq1234567890abcdef1234', { limit: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.id).toBe('mem1');
      expect(result.items[1]!.id).toBe('mem2');
      expect(result.totalCount).toBe(2);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
    });

    it('should apply tag filtering correctly', async () => {
      const memory1 = {
        id: 'mem1',
        userId: 'clq1234567890abcdef1234',
        content: 'Memory 1',
        metadata: null,
        tags: ['tag1'],
        type: 'short-term' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        ttl: 3600,
      };

      const memory2 = {
        id: 'mem2',
        userId: 'clq1234567890abcdef1234',
        content: 'Memory 2',
        metadata: null,
        tags: ['tag2'],
        type: 'short-term' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        ttl: 3600,
      };

      // Mock for list operation
      mockRedisService.scan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['memory:stm:clq1234567890abcdef1234:mem1', 'memory:stm:clq1234567890abcdef1234:mem2'],
      });

      const mockPipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, JSON.stringify(memory1)],
          [null, JSON.stringify(memory2)],
        ]),
      };
      mockRedisService.pipeline.mockReturnValue(mockPipeline);

      // Mock for count operation with tag filtering
      mockRedisService.scan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['memory:stm:clq1234567890abcdef1234:mem1', 'memory:stm:clq1234567890abcdef1234:mem2'],
      });

      const result = await service.list('clq1234567890abcdef1234', { tags: ['tag1'] });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('mem1');
      expect(result.items[0]!.tags).toContain('tag1');
    });

    it('should handle pagination with cursors', async () => {
      // Mock for list operation
      mockRedisService.scan.mockResolvedValueOnce({
        cursor: '123',
        keys: [],
      });

      const mockPipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      mockRedisService.pipeline.mockReturnValue(mockPipeline);

      // Mock for count operation
      mockRedisService.scan.mockResolvedValueOnce({
        cursor: '0',
        keys: [],
      });

      const result = await service.list('clq1234567890abcdef1234', { cursor: '0' });

      expect(result.startCursor).toBe('0');
      expect(result.endCursor).toBe('123');
      expect(result.hasPreviousPage).toBe(false);
    });

    it('should return empty result for non-existent user', async () => {
      // Mock for list operation
      mockRedisService.scan.mockResolvedValueOnce({
        cursor: '0',
        keys: [],
      });

      const mockPipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      mockRedisService.pipeline.mockReturnValue(mockPipeline);

      // Mock for count operation
      mockRedisService.scan.mockResolvedValueOnce({
        cursor: '0',
        keys: [],
      });

      const result = await service.list('clq1234567890abcdef9999');

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('count', () => {
    it('should count all memories for a user', async () => {
      mockRedisService.scan.mockResolvedValue({
        cursor: '0',
        keys: ['memory:stm:clq1234567890abcdef1234:mem1', 'memory:stm:clq1234567890abcdef1234:mem2'],
      });

      const result = await service.count('clq1234567890abcdef1234');

      expect(result).toBe(2);
      expect(mockRedisService.scan).toHaveBeenCalledWith('0', {
        match: 'memory:stm:clq1234567890abcdef1234:*',
        count: 1000,
      });
    });

    it('should apply tag filtering to count', async () => {
      const memory1 = {
        id: 'mem1',
        userId: 'clq1234567890abcdef1234',
        content: 'Memory 1',
        metadata: null,
        tags: ['tag1'],
        type: 'short-term' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        ttl: 3600,
      };

      const memory2 = {
        id: 'mem2',
        userId: 'clq1234567890abcdef1234',
        content: 'Memory 2',
        metadata: null,
        tags: ['tag2'],
        type: 'short-term' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        ttl: 3600,
      };

      mockRedisService.scan.mockResolvedValue({
        cursor: '0',
        keys: ['memory:stm:clq1234567890abcdef1234:mem1', 'memory:stm:clq1234567890abcdef1234:mem2'],
      });

      const mockPipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, JSON.stringify(memory1)],
          [null, JSON.stringify(memory2)],
        ]),
      };
      mockRedisService.pipeline.mockReturnValue(mockPipeline);

      const result = await service.count('clq1234567890abcdef1234', { tags: ['tag1'] });

      expect(result).toBe(1);
    });

    it('should return 0 for non-existent user', async () => {
      mockRedisService.scan.mockResolvedValue({
        cursor: '0',
        keys: [],
      });

      const result = await service.count('clq1234567890abcdef9999');

      expect(result).toBe(0);
    });

    it('should handle multiple scan iterations', async () => {
      mockRedisService.scan
        .mockResolvedValueOnce({
          cursor: '123',
          keys: ['memory:stm:clq1234567890abcdef1234:mem1'],
        })
        .mockResolvedValueOnce({
          cursor: '0',
          keys: ['memory:stm:clq1234567890abcdef1234:mem2'],
        });

      const result = await service.count('clq1234567890abcdef1234');

      expect(result).toBe(2);
      expect(mockRedisService.scan).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear', () => {
    it('should clear all memories for a user', async () => {
      mockRedisService.scan.mockResolvedValue({
        cursor: '0',
        keys: ['memory:stm:clq1234567890abcdef1234:mem1', 'memory:stm:clq1234567890abcdef1234:mem2'],
      });
      mockRedisService.delMany.mockResolvedValue(2);

      const result = await service.clear('clq1234567890abcdef1234');

      expect(result).toBe(2);
      expect(mockRedisService.delMany).toHaveBeenCalledWith([
        'memory:stm:clq1234567890abcdef1234:mem1',
        'memory:stm:clq1234567890abcdef1234:mem2',
      ]);
    });

    it('should return correct count of deleted memories', async () => {
      mockRedisService.scan.mockResolvedValue({
        cursor: '0',
        keys: ['memory:stm:clq1234567890abcdef1234:mem1'],
      });
      mockRedisService.delMany.mockResolvedValue(1);

      const result = await service.clear('clq1234567890abcdef1234');

      expect(result).toBe(1);
    });

    it('should handle empty user gracefully', async () => {
      mockRedisService.scan.mockResolvedValue({
        cursor: '0',
        keys: [],
      });

      const result = await service.clear('clq1234567890abcdef9999');

      expect(result).toBe(0);
      expect(mockRedisService.delMany).not.toHaveBeenCalled();
    });

    it('should handle multiple scan iterations', async () => {
      mockRedisService.scan
        .mockResolvedValueOnce({
          cursor: '123',
          keys: ['memory:stm:clq1234567890abcdef1234:mem1', 'memory:stm:clq1234567890abcdef1234:mem2'],
        })
        .mockResolvedValueOnce({
          cursor: '0',
          keys: ['memory:stm:clq1234567890abcdef1234:mem3'],
        });
      mockRedisService.delMany.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const result = await service.clear('clq1234567890abcdef1234');

      expect(result).toBe(3);
      expect(mockRedisService.scan).toHaveBeenCalledTimes(2);
      expect(mockRedisService.delMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('validateTtl', () => {
    it('should accept valid TTL values', async () => {
      const input: CreateStmMemoryData = {
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        ttl: 3600, // Valid: 1 hour
      };

      mockRedisService.set.mockResolvedValue('OK');

      await expect(service.create(input)).resolves.toBeDefined();
    });

    it('should reject TTL below minimum', async () => {
      const input: CreateStmMemoryData = {
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        ttl: 30, // Invalid: below 60 seconds
      };

      // Zod validation throws ZodError with message
      await expect(service.create(input)).rejects.toThrow('TTL must be at least 1 minute');
    });

    it('should reject TTL above maximum', async () => {
      const input: CreateStmMemoryData = {
        userId: 'clq1234567890abcdef1234',
        content: 'Test content',
        ttl: 700000, // Invalid: above 7 days
      };

      // Zod validation throws ZodError with specific message
      await expect(service.create(input)).rejects.toThrow('TTL cannot exceed 7 days');
    });
  });
});