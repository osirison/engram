import { Test, TestingModule } from '@nestjs/testing';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';

describe('MemoryController', () => {
  let controller: MemoryController;
  let memoryService: MemoryService;

  const mockMemoryService = {
    createMemory: jest.fn(),
    createStm: jest.fn(),
    createLtm: jest.fn(),
    getMemory: jest.fn(),
    listMemories: jest.fn(),
    updateMemory: jest.fn(),
    deleteMemory: jest.fn(),
    promoteMemory: jest.fn(),
    recall: jest.fn(),
    reindex: jest.fn(),
  };

  const mockReindexQueueService = {
    enqueue: jest.fn(),
    get: jest.fn(),
    cancel: jest.fn(),
    retry: jest.fn(),
  };

  const parseResponsePayload = <T>(response: {
    content: Array<{ text: string }>;
  }): T => {
    const first = response.content[0];

    if (!first) {
      throw new Error('Response did not include text content');
    }

    return JSON.parse(first.text) as T;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.MCP_ADMIN_TOKEN = 'test-admin-token-12345';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [
        {
          provide: MemoryService,
          useValue: mockMemoryService,
        },
        {
          provide: ReindexQueueService,
          useValue: mockReindexQueueService,
        },
      ],
    }).compile();

    controller = module.get<MemoryController>(MemoryController);
    memoryService = module.get<MemoryService>(MemoryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have memory service dependency', () => {
    expect(memoryService).toBeDefined();
  });

  describe('getMcpTools', () => {
    it('should register the recall tool', () => {
      const tools = controller.getMcpTools();
      const recallTool = tools.find((tool) => tool.name === 'recall');

      expect(recallTool).toBeDefined();
      expect(recallTool?.inputSchema).toBeDefined();
      expect(typeof recallTool?.handler).toBe('function');
    });

    it('should register the reindex_memories tool', () => {
      const tools = controller.getMcpTools();
      const reindexTool = tools.find(
        (tool) => tool.name === 'reindex_memories',
      );

      expect(reindexTool).toBeDefined();
      expect(reindexTool?.inputSchema).toBeDefined();
      expect(typeof reindexTool?.handler).toBe('function');
    });

    it('should register queued reindex tools', () => {
      const tools = controller.getMcpTools();
      const queueTool = tools.find(
        (tool) => tool.name === 'queue_reindex_memories',
      );
      const statusTool = tools.find(
        (tool) => tool.name === 'get_reindex_status',
      );
      const cancelTool = tools.find(
        (tool) => tool.name === 'cancel_reindex_job',
      );
      const retryTool = tools.find((tool) => tool.name === 'retry_reindex_job');

      expect(queueTool).toBeDefined();
      expect(statusTool).toBeDefined();
      expect(cancelTool).toBeDefined();
      expect(retryTool).toBeDefined();
    });
  });

  describe('recall', () => {
    it('should validate input, delegate to the service, and shape the result', async () => {
      const userId = 'clm0000000000000000000000';
      mockMemoryService.recall.mockResolvedValue([
        {
          score: 0.92,
          memory: { id: 'ltm-1', userId, content: 'hello world' },
        },
      ]);

      const response = await controller.recall({
        userId,
        query: 'hello',
        limit: 5,
        scope: 'project-a',
        tags: ['greeting'],
      });

      expect(mockMemoryService.recall).toHaveBeenCalledWith(userId, 'hello', {
        limit: 5,
        scope: 'project-a',
        tags: ['greeting'],
        createdFrom: undefined,
        createdTo: undefined,
      });

      const payload = parseResponsePayload<{
        query: string;
        count: number;
        results: Array<{ score: number; memory: { id: string } }>;
      }>(response);
      expect(payload.query).toBe('hello');
      expect(payload.count).toBe(1);
      expect(payload.results[0]!.score).toBe(0.92);
      expect(payload.results[0]!.memory.id).toBe('ltm-1');
    });

    it('should pass date-range filters to the service', async () => {
      const userId = 'clm0000000000000000000000';
      mockMemoryService.recall.mockResolvedValue([]);

      await controller.recall({
        userId,
        query: 'recent notes',
        createdFrom: '2025-01-01T00:00:00Z',
        createdTo: '2025-06-01T00:00:00Z',
      });

      expect(mockMemoryService.recall).toHaveBeenCalledWith(
        userId,
        'recent notes',
        expect.objectContaining({
          createdFrom: new Date('2025-01-01T00:00:00Z'),
          createdTo: new Date('2025-06-01T00:00:00Z'),
        }),
      );
    });

    it('should reject when createdFrom is after createdTo', async () => {
      const userId = 'clm0000000000000000000000';
      await expect(
        controller.recall({
          userId,
          query: 'notes',
          createdFrom: '2025-06-01T00:00:00Z',
          createdTo: '2025-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(/createdFrom must be before or equal to createdTo/);
    });

    it('should reject invalid input', async () => {
      await expect(controller.recall({ query: '' })).rejects.toThrow(
        /Failed to recall memories/,
      );
    });
  });

  describe('reindexMemories', () => {
    it('should validate input, delegate to the service, and shape the result', async () => {
      const userId = 'clm0000000000000000000000';
      mockMemoryService.reindex.mockResolvedValue({
        processed: 5,
        indexed: 4,
        skipped: 1,
        failed: 0,
        cursor: null,
      });

      const response = await controller.reindexMemories({
        adminToken: 'test-admin-token-12345',
        userId,
        batchSize: 50,
        reuseExistingEmbeddings: false,
      });

      expect(mockMemoryService.reindex).toHaveBeenCalledWith({
        userId,
        batchSize: 50,
        reuseExistingEmbeddings: false,
        cursor: undefined,
        maxMemories: undefined,
      });

      const payload = parseResponsePayload<{
        scope: string;
        processed: number;
        indexed: number;
        skipped: number;
      }>(response);
      expect(payload.scope).toBe(userId);
      expect(payload.processed).toBe(5);
      expect(payload.indexed).toBe(4);
      expect(payload.skipped).toBe(1);
    });

    it('should report all-users scope when no userId is given', async () => {
      mockMemoryService.reindex.mockResolvedValue({
        processed: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        cursor: null,
      });

      const response = await controller.reindexMemories({
        adminToken: 'test-admin-token-12345',
      });
      const payload = parseResponsePayload<{ scope: string }>(response);
      expect(payload.scope).toBe('all-users');
    });

    it('should reject an invalid batch size', async () => {
      await expect(
        controller.reindexMemories({
          adminToken: 'test-admin-token-12345',
          batchSize: 99999,
        }),
      ).rejects.toThrow(/Failed to reindex memories/);
    });

    it('rejects unauthorized admin token', async () => {
      await expect(
        controller.reindexMemories({
          adminToken: 'wrong-token-123456',
        }),
      ).rejects.toThrow(/Failed to reindex memories: Unauthorized/);
    });
  });

  describe('queueReindexMemories', () => {
    it('queues a reindex job and returns job metadata', async () => {
      mockReindexQueueService.enqueue.mockResolvedValue({
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
        state: 'queued',
        createdAt: '2026-06-01T00:00:00.000Z',
      });

      const response = await controller.queueReindexMemories({
        adminToken: 'test-admin-token-12345',
        batchSize: 100,
      });
      const payload = parseResponsePayload<{ jobId: string; state: string }>(
        response,
      );

      expect(mockReindexQueueService.enqueue).toHaveBeenCalledWith({
        userId: undefined,
        batchSize: 100,
        reuseExistingEmbeddings: undefined,
        cursor: undefined,
        maxMemories: undefined,
      });
      expect(payload.jobId).toBe('2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1');
      expect(payload.state).toBe('queued');
    });
  });

  describe('getReindexStatus', () => {
    it('returns not_found when job is missing', async () => {
      mockReindexQueueService.get.mockResolvedValue(null);

      const response = await controller.getReindexStatus({
        adminToken: 'test-admin-token-12345',
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
      });
      const payload = parseResponsePayload<{ state: string }>(response);

      expect(payload.state).toBe('not_found');
    });

    it('returns persisted job status', async () => {
      mockReindexQueueService.get.mockResolvedValue({
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
        state: 'running',
        summary: {
          processed: 10,
          indexed: 10,
          skipped: 0,
          failed: 0,
          cursor: 'c1',
        },
      });

      const response = await controller.getReindexStatus({
        adminToken: 'test-admin-token-12345',
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
      });
      const payload = parseResponsePayload<{
        state: string;
        summary: { cursor: string | null };
      }>(response);

      expect(payload.state).toBe('running');
      expect(payload.summary.cursor).toBe('c1');
    });
  });

  describe('cancelReindexJob', () => {
    it('cancels an active job', async () => {
      mockReindexQueueService.cancel.mockResolvedValue({
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
        state: 'cancelled',
      });

      const response = await controller.cancelReindexJob({
        adminToken: 'test-admin-token-12345',
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
      });
      const payload = parseResponsePayload<{ state: string }>(response);

      expect(payload.state).toBe('cancelled');
      expect(mockReindexQueueService.cancel).toHaveBeenCalledWith(
        '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
      );
    });
  });

  describe('retryReindexJob', () => {
    it('retries a failed/cancelled job', async () => {
      mockReindexQueueService.retry.mockResolvedValue({
        jobId: '9a50b8bb-8394-4513-8e88-2187944c5fe8',
        state: 'queued',
      });

      const response = await controller.retryReindexJob({
        adminToken: 'test-admin-token-12345',
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
      });
      const payload = parseResponsePayload<{ state: string }>(response);

      expect(payload.state).toBe('queued');
      expect(mockReindexQueueService.retry).toHaveBeenCalledWith(
        '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
      );
    });
  });

  describe('createMemory', () => {
    const userId = 'clm0000000000000000000000';
    const memoryId = 'clm1111111111111111111111';

    it('creates a short-term memory and returns its id in the response', async () => {
      mockMemoryService.createMemory.mockResolvedValue({
        id: memoryId,
        type: 'short-term',
        content: 'hello world',
      });

      const response = await controller.createMemory({
        userId,
        content: 'hello world',
        type: 'short-term',
        ttl: 300,
      });

      expect(mockMemoryService.createMemory).toHaveBeenCalledWith({
        userId,
        content: 'hello world',
        type: 'short-term',
        metadata: undefined,
        tags: [],
        ttl: 300,
      });
      expect(response.content[0]?.text).toContain(memoryId);
      expect(response.content[0]?.text).toContain('short-term');
    });

    it('creates a long-term memory', async () => {
      mockMemoryService.createMemory.mockResolvedValue({
        id: memoryId,
        type: 'long-term',
      });

      const response = await controller.createMemory({
        userId,
        content: 'important note',
        type: 'long-term',
      });

      expect(response.content[0]?.text).toContain('long-term');
    });

    it('rejects missing required content field', async () => {
      await expect(
        controller.createMemory({ userId, type: 'short-term' }),
      ).rejects.toThrow(/Failed to create memory/);
    });

    it('rejects content that exceeds the 10KB limit', async () => {
      await expect(
        controller.createMemory({
          userId,
          content: 'x'.repeat(10241),
          type: 'long-term',
        }),
      ).rejects.toThrow(/Failed to create memory/);
    });

    it('wraps service errors', async () => {
      mockMemoryService.createMemory.mockRejectedValue(
        new Error('quota exceeded'),
      );

      await expect(
        controller.createMemory({
          userId,
          content: 'hello',
          type: 'long-term',
        }),
      ).rejects.toThrow(/Failed to create memory: quota exceeded/);
    });
  });

  describe('getMemory', () => {
    const userId = 'clm0000000000000000000000';
    const memoryId = 'clm1111111111111111111111';

    it('returns the serialised memory when found', async () => {
      const memory = {
        id: memoryId,
        userId,
        content: 'hello',
        type: 'long-term',
      };
      mockMemoryService.getMemory.mockResolvedValue(memory);

      const response = await controller.getMemory({ userId, memoryId });

      const payload = parseResponsePayload<{ id: string; content: string }>(
        response,
      );
      expect(payload.id).toBe(memoryId);
      expect(payload.content).toBe('hello');
      expect(mockMemoryService.getMemory).toHaveBeenCalledWith(
        userId,
        memoryId,
      );
    });

    it('returns a not-found message when memory is absent', async () => {
      mockMemoryService.getMemory.mockResolvedValue(null);

      const response = await controller.getMemory({ userId, memoryId });

      expect(response.content[0]?.text).toContain('not found');
    });

    it('rejects invalid userId', async () => {
      await expect(
        controller.getMemory({ userId: 'not-a-cuid', memoryId }),
      ).rejects.toThrow(/Failed to get memory/);
    });
  });

  describe('listMemories', () => {
    const userId = 'clm0000000000000000000000';

    it('lists memories with default options', async () => {
      mockMemoryService.listMemories.mockResolvedValue({
        items: [{ id: 'clm1111111111111111111111', content: 'hello' }],
        totalCount: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const response = await controller.listMemories({ userId });

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith(userId, {
        limit: 20,
        cursor: undefined,
        tags: undefined,
        search: undefined,
      });

      const payload = parseResponsePayload<{
        memories: unknown[];
        pagination: { totalCount: number; hasNextPage: boolean };
      }>(response);
      expect(payload.memories).toHaveLength(1);
      expect(payload.pagination.totalCount).toBe(1);
      expect(payload.pagination.hasNextPage).toBe(false);
    });

    it('passes filtering options through to the service', async () => {
      mockMemoryService.listMemories.mockResolvedValue({
        items: [],
        totalCount: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      await controller.listMemories({
        userId,
        limit: 5,
        tags: ['work'],
        search: 'meeting notes',
      });

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith(userId, {
        limit: 5,
        cursor: undefined,
        tags: ['work'],
        search: 'meeting notes',
      });
    });

    it('rejects invalid userId', async () => {
      await expect(
        controller.listMemories({ userId: 'not-a-cuid' }),
      ).rejects.toThrow(/Failed to list memories/);
    });
  });

  describe('updateMemory', () => {
    const userId = 'clm0000000000000000000000';
    const memoryId = 'clm1111111111111111111111';

    it('updates memory and includes it in the response text', async () => {
      const updated = { id: memoryId, userId, content: 'new content' };
      mockMemoryService.updateMemory.mockResolvedValue(updated);

      const response = await controller.updateMemory({
        userId,
        memoryId,
        content: 'new content',
      });

      expect(mockMemoryService.updateMemory).toHaveBeenCalledWith(
        userId,
        memoryId,
        {
          content: 'new content',
          metadata: undefined,
          tags: undefined,
          ttl: undefined,
        },
      );
      expect(response.content[0]?.text).toContain(memoryId);
    });

    it('rejects invalid memoryId', async () => {
      await expect(
        controller.updateMemory({ userId, memoryId: 'not-a-cuid' }),
      ).rejects.toThrow(/Failed to update memory/);
    });

    it('wraps service errors', async () => {
      mockMemoryService.updateMemory.mockRejectedValue(
        new Error('memory not found'),
      );

      await expect(
        controller.updateMemory({ userId, memoryId }),
      ).rejects.toThrow(/Failed to update memory: memory not found/);
    });
  });

  describe('deleteMemory', () => {
    const userId = 'clm0000000000000000000000';
    const memoryId = 'clm1111111111111111111111';

    it('returns a success message when memory is deleted', async () => {
      mockMemoryService.deleteMemory.mockResolvedValue(true);

      const response = await controller.deleteMemory({ userId, memoryId });

      expect(response.content[0]?.text).toContain('Successfully deleted');
      expect(mockMemoryService.deleteMemory).toHaveBeenCalledWith(
        userId,
        memoryId,
      );
    });

    it('returns a not-found message when nothing was deleted', async () => {
      mockMemoryService.deleteMemory.mockResolvedValue(false);

      const response = await controller.deleteMemory({ userId, memoryId });

      expect(response.content[0]?.text).toContain('not found');
    });

    it('rejects invalid userId', async () => {
      await expect(
        controller.deleteMemory({ userId: 'not-a-cuid', memoryId }),
      ).rejects.toThrow(/Failed to delete memory/);
    });
  });

  describe('promoteMemory', () => {
    const userId = 'clm0000000000000000000000';
    const memoryId = 'clm1111111111111111111111';

    it('promotes memory to long-term and returns confirmation', async () => {
      const promoted = {
        id: memoryId,
        userId,
        type: 'long-term',
        content: 'hello',
      };
      mockMemoryService.promoteMemory.mockResolvedValue(promoted);

      const response = await controller.promoteMemory({ userId, memoryId });

      expect(mockMemoryService.promoteMemory).toHaveBeenCalledWith(
        userId,
        memoryId,
      );
      expect(response.content[0]?.text).toContain('Successfully promoted');
      expect(response.content[0]?.text).toContain(memoryId);
    });

    it('rejects invalid input', async () => {
      await expect(
        controller.promoteMemory({ userId: 'not-a-cuid', memoryId }),
      ).rejects.toThrow(/Failed to promote memory/);
    });

    it('wraps service errors', async () => {
      mockMemoryService.promoteMemory.mockRejectedValue(
        new Error('quota exceeded'),
      );

      await expect(
        controller.promoteMemory({ userId, memoryId }),
      ).rejects.toThrow(/Failed to promote memory: quota exceeded/);
    });
  });

  describe('assertAdminAuthorized', () => {
    it('throws when MCP_ADMIN_TOKEN env var is not configured', async () => {
      const original = process.env.MCP_ADMIN_TOKEN;
      delete process.env.MCP_ADMIN_TOKEN;

      try {
        await expect(
          controller.reindexMemories({ adminToken: 'test-admin-token-12345' }),
        ).rejects.toThrow(/MCP_ADMIN_TOKEN is not configured/);
      } finally {
        process.env.MCP_ADMIN_TOKEN = original;
      }
    });
  });
});
