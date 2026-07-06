import { Test, TestingModule } from '@nestjs/testing';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';
import { GENERIC_CLIENT_ERROR_DETAIL } from '../security/client-error.util';

/**
 * Assert an operation failed with the generic client-facing message and did
 * NOT leak the internal error detail (Prisma/Redis/vector-store messages must
 * stay server-side).
 */
const expectGenericFailure = async (
  promise: Promise<unknown>,
  prefix: string,
  internalDetail: string,
): Promise<void> => {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(
    `${prefix}: ${GENERIC_CLIENT_ERROR_DETAIL}`,
  );
  expect((error as Error).message).not.toContain(internalDetail);
};

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
    reembedMemory: jest.fn(),
    recall: jest.fn(),
    reindex: jest.fn(),
  };

  const mockReindexQueueService = {
    enqueue: jest.fn(),
    get: jest.fn(),
    cancel: jest.fn(),
    retry: jest.fn(),
  };

  const mockConsolidationService = {
    run: jest.fn(),
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
        {
          provide: ConsolidationService,
          useValue: mockConsolidationService,
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

    it('wraps enqueue errors without leaking internal details', async () => {
      mockReindexQueueService.enqueue.mockRejectedValue(
        new Error('queue unavailable'),
      );

      await expectGenericFailure(
        controller.queueReindexMemories({
          adminToken: 'test-admin-token-12345',
        }),
        'Failed to queue reindex job',
        'queue unavailable',
      );
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

    it('wraps lookup errors without leaking internal details', async () => {
      mockReindexQueueService.get.mockRejectedValue(new Error('db down'));

      await expectGenericFailure(
        controller.getReindexStatus({
          adminToken: 'test-admin-token-12345',
          jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
        }),
        'Failed to get reindex status',
        'db down',
      );
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

    it('returns not_found when no such job exists', async () => {
      mockReindexQueueService.cancel.mockResolvedValue(null);

      const response = await controller.cancelReindexJob({
        adminToken: 'test-admin-token-12345',
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
      });
      const payload = parseResponsePayload<{ state: string }>(response);

      expect(payload.state).toBe('not_found');
    });

    it('wraps cancel errors without leaking internal details', async () => {
      mockReindexQueueService.cancel.mockRejectedValue(new Error('db error'));

      await expectGenericFailure(
        controller.cancelReindexJob({
          adminToken: 'test-admin-token-12345',
          jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
        }),
        'Failed to cancel reindex job',
        'db error',
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

    it('returns not_found when no such job exists', async () => {
      mockReindexQueueService.retry.mockResolvedValue(null);

      const response = await controller.retryReindexJob({
        adminToken: 'test-admin-token-12345',
        jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
      });
      const payload = parseResponsePayload<{ state: string }>(response);

      expect(payload.state).toBe('not_found');
    });

    it('wraps retry errors without leaking internal details', async () => {
      mockReindexQueueService.retry.mockRejectedValue(new Error('db error'));

      await expectGenericFailure(
        controller.retryReindexJob({
          adminToken: 'test-admin-token-12345',
          jobId: '2ec89f7a-6e83-48f0-901d-b9fbd58fa8e1',
        }),
        'Failed to retry reindex job',
        'db error',
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

    it('wraps service errors without leaking internal details', async () => {
      mockMemoryService.createMemory.mockRejectedValue(
        new Error('quota exceeded'),
      );

      await expectGenericFailure(
        controller.createMemory({
          userId,
          content: 'hello',
          type: 'long-term',
        }),
        'Failed to create memory',
        'quota exceeded',
      );
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
        undefined,
      );
    });

    it('returns a structured not-found sentinel (plus prose) when memory is absent', async () => {
      mockMemoryService.getMemory.mockResolvedValue(null);

      const response = await controller.getMemory({ userId, memoryId });

      // First item is machine-readable JSON (WP2 T2/D2), prose stays second.
      expect(JSON.parse(response.content[0]?.text ?? '{}')).toEqual({
        found: false,
        memoryId,
      });
      expect(response.content[1]?.text).toContain('not found');
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
          expectedVersion: undefined,
        },
        undefined,
      );
      expect(response.content[0]?.text).toContain(memoryId);
    });

    it('threads expectedVersion to the service and surfaces conflicts as CONFLICT: (WP2 T4)', async () => {
      const conflict = new Error(
        'Long-term memory clm1 was modified (currentVersion=7)',
      );
      conflict.name = 'LtmVersionConflictError';
      mockMemoryService.updateMemory.mockRejectedValue(conflict);

      await expect(
        controller.updateMemory({
          userId,
          memoryId,
          content: 'x',
          expectedVersion: 3,
        }),
      ).rejects.toThrow(/CONFLICT:/);

      // expectedVersion reaches the service DTO.
      expect(mockMemoryService.updateMemory).toHaveBeenCalledWith(
        userId,
        memoryId,
        expect.objectContaining({ expectedVersion: 3 }),
        undefined,
      );
    });

    it('rejects invalid memoryId', async () => {
      await expect(
        controller.updateMemory({ userId, memoryId: 'not-a-cuid' }),
      ).rejects.toThrow(/Failed to update memory/);
    });

    it('wraps service errors without leaking internal details', async () => {
      mockMemoryService.updateMemory.mockRejectedValue(
        new Error('memory not found'),
      );

      await expectGenericFailure(
        controller.updateMemory({ userId, memoryId }),
        'Failed to update memory',
        'memory not found',
      );
    });
  });

  describe('deleteMemory', () => {
    const userId = 'clm0000000000000000000000';
    const memoryId = 'clm1111111111111111111111';

    it('returns a structured deleted result (plus prose) when memory is deleted', async () => {
      mockMemoryService.deleteMemory.mockResolvedValue(true);

      const response = await controller.deleteMemory({ userId, memoryId });

      // First item is machine-readable JSON (WP2 T2/D2/A10), prose stays second.
      expect(JSON.parse(response.content[0]?.text ?? '{}')).toEqual({
        deleted: true,
        memoryId,
      });
      expect(response.content[1]?.text).toContain('Successfully deleted');
      expect(mockMemoryService.deleteMemory).toHaveBeenCalledWith(
        userId,
        memoryId,
        undefined,
      );
    });

    it('returns deleted:false (plus prose) when nothing was deleted', async () => {
      mockMemoryService.deleteMemory.mockResolvedValue(false);

      const response = await controller.deleteMemory({ userId, memoryId });

      expect(JSON.parse(response.content[0]?.text ?? '{}')).toEqual({
        deleted: false,
        memoryId,
      });
      expect(response.content[1]?.text).toContain('not found');
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
        undefined,
      );
      // Structured first item (WP2 T3/D2): the promoted memory (new LTM id) is
      // machine-readable; prose stays second.
      const parsed = JSON.parse(response.content[0]?.text ?? '{}') as {
        promoted: boolean;
        memory: { id: string };
      };
      expect(parsed.promoted).toBe(true);
      expect(parsed.memory.id).toBe(memoryId);
      expect(response.content[1]?.text).toContain('Successfully promoted');
    });

    it('rejects invalid input', async () => {
      await expect(
        controller.promoteMemory({ userId: 'not-a-cuid', memoryId }),
      ).rejects.toThrow(/Failed to promote memory/);
    });

    it('wraps service errors without leaking internal details', async () => {
      mockMemoryService.promoteMemory.mockRejectedValue(
        new Error('quota exceeded'),
      );

      await expectGenericFailure(
        controller.promoteMemory({ userId, memoryId }),
        'Failed to promote memory',
        'quota exceeded',
      );
    });
  });

  describe('reembedMemory (WP2 T7)', () => {
    const userId = 'clm0000000000000000000000';
    const memoryId = 'clm1111111111111111111111';

    it('registers reembed_memory as a delegable memories:write tool', () => {
      const tool = controller
        .getMcpTools()
        .find((t) => t.name === 'reembed_memory');
      expect(tool).toBeDefined();
      expect(tool?.delegable).toBe(true);
      expect(tool?.requiredScope).toBe('memories:write');
    });

    it('re-embeds and returns the memory', async () => {
      mockMemoryService.reembedMemory.mockResolvedValue({
        id: memoryId,
        userId,
      });
      const response = await controller.reembedMemory({ userId, memoryId });
      expect(mockMemoryService.reembedMemory).toHaveBeenCalledWith(
        userId,
        memoryId,
        undefined,
      );
      expect(response.content[0]?.text).toContain(memoryId);
    });

    it('surfaces a provider-unavailable error with a client-safe message', async () => {
      const err = new Error('Cannot re-embed: provider down');
      err.name = 'LtmEmbeddingUnavailableError';
      mockMemoryService.reembedMemory.mockRejectedValue(err);
      await expect(
        controller.reembedMemory({ userId, memoryId }),
      ).rejects.toThrow(/embeddings provider is unavailable/);
    });
  });

  describe('consolidateMemories', () => {
    it('runs a consolidation pass and returns counts', async () => {
      mockConsolidationService.run.mockResolvedValue({
        promoted: 3,
        skipped: 1,
        failed: 0,
      });

      const response = await controller.consolidateMemories({
        adminToken: 'test-admin-token-12345',
      });
      const payload = parseResponsePayload<{
        success: boolean;
        promoted: number;
        skipped: number;
        failed: number;
      }>(response);

      expect(payload.success).toBe(true);
      expect(payload.promoted).toBe(3);
      expect(payload.skipped).toBe(1);
      expect(payload.failed).toBe(0);
      expect(mockConsolidationService.run).toHaveBeenCalledWith(undefined);
    });

    it('passes userId filter when provided', async () => {
      mockConsolidationService.run.mockResolvedValue({
        promoted: 0,
        skipped: 0,
        failed: 0,
      });
      const userId = 'clm0000000000000000000000';

      await controller.consolidateMemories({
        adminToken: 'test-admin-token-12345',
        userId,
      });

      expect(mockConsolidationService.run).toHaveBeenCalledWith(userId);
    });

    it('wraps consolidation errors without leaking internal details', async () => {
      mockConsolidationService.run.mockRejectedValue(
        new Error('service unavailable'),
      );

      await expectGenericFailure(
        controller.consolidateMemories({
          adminToken: 'test-admin-token-12345',
        }),
        'Failed to run consolidation',
        'service unavailable',
      );
    });

    it('rejects unauthorized admin token', async () => {
      await expect(
        controller.consolidateMemories({
          adminToken: 'wrong-token-12345678',
        }),
      ).rejects.toThrow(/Unauthorized/);
    });
  });

  describe('client-facing error hygiene through the MCP tool seam', () => {
    const userId = 'clm0000000000000000000000';

    it('returns only the generic message when a tool handler hits an internal error', async () => {
      mockMemoryService.createMemory.mockRejectedValue(
        new Error(
          'connect ECONNREFUSED 10.1.2.3:5432 (postgresql://engram:s3cret@db/engram)',
        ),
      );

      const tool = controller
        .getMcpTools()
        .find((t) => t.name === 'create_memory');
      expect(tool).toBeDefined();

      const error = await tool!
        .handler({ userId, content: 'hello', type: 'long-term' })
        .then(
          () => {
            throw new Error('expected the handler to reject');
          },
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toBe(
        `Failed to create memory: ${GENERIC_CLIENT_ERROR_DETAIL}`,
      );
      expect(message).not.toContain('ECONNREFUSED');
      expect(message).not.toContain('s3cret');
    });

    it('still surfaces validation errors so callers can fix their input', async () => {
      const tool = controller.getMcpTools().find((t) => t.name === 'recall');
      expect(tool).toBeDefined();

      await expect(
        tool!.handler({
          userId,
          query: 'notes',
          createdFrom: '2025-06-01T00:00:00Z',
          createdTo: '2025-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(/createdFrom must be before or equal to createdTo/);
    });

    it('still surfaces authored admin-auth errors', async () => {
      const tool = controller
        .getMcpTools()
        .find((t) => t.name === 'reindex_memories');
      expect(tool).toBeDefined();

      await expect(
        tool!.handler({ adminToken: 'wrong-token-123456' }),
      ).rejects.toThrow(/Unauthorized maintenance operation/);
    });
  });

  describe('getMcpToolDefinitions', () => {
    it('returns a list of tool definitions including create_memory', () => {
      const defs = controller.getMcpToolDefinitions();

      expect(Array.isArray(defs)).toBe(true);
      expect(defs.length).toBeGreaterThan(0);
      expect(defs[0]).toMatchObject({
        name: 'create_memory',
        description: expect.stringContaining('memory') as unknown,
        inputSchema: expect.objectContaining({ type: 'object' }) as unknown,
      });
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

// ── WP2 T5: audit trail + restore wiring ───────────────────────────────────────
import { MemoryAuditService } from './memory-audit.service';
import type { ToolCallContext } from '@engram/core';

describe('MemoryController audit wiring (WP2 T5)', () => {
  let controller: MemoryController;

  const userId = 'clm0000000000000000000000';
  const memoryId = 'clm1111111111111111111111';
  const ctx: ToolCallContext = {
    actorUserId: userId,
    apiKeyId: 'key_op',
    scopes: ['admin'],
    delegated: true,
  };

  const svc = {
    getMemory: jest.fn(),
    updateMemory: jest.fn(),
    deleteMemory: jest.fn(),
    bulkDeleteMemories: jest.fn(),
    promoteMemory: jest.fn(),
    reembedMemory: jest.fn(),
    restoreMemory: jest.fn(),
  };
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue([]),
    findLatestDeleteSnapshot: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [
        { provide: MemoryService, useValue: svc },
        { provide: ReindexQueueService, useValue: {} },
        { provide: ConsolidationService, useValue: {} },
        { provide: MemoryAuditService, useValue: audit },
      ],
    }).compile();
    controller = module.get<MemoryController>(MemoryController);
  });

  it('records an update audit row carrying the dispatch delegation facts + before/after', async () => {
    svc.getMemory.mockResolvedValue({
      id: memoryId,
      userId,
      content: 'old',
      tags: ['a'],
      metadata: null,
      type: 'long-term',
      scope: null,
      organizationId: null,
      expiresAt: null,
      version: 3,
    });
    svc.updateMemory.mockResolvedValue({
      id: memoryId,
      userId,
      content: 'new',
      tags: ['a'],
      metadata: null,
      version: 4,
      scope: null,
    });

    await controller.updateMemory(
      { userId, memoryId, content: 'new', actorLabel: 'op@example.com' },
      ctx,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId,
        userId,
        action: 'update',
        context: ctx,
        actorLabel: 'op@example.com',
        before: expect.objectContaining({ content: 'old', version: 3 }),
        after: expect.objectContaining({ content: 'new', version: 4 }),
      }),
    );
  });

  it("captures a delete's before-snapshot (the restore source) and records the attempt", async () => {
    svc.getMemory.mockResolvedValue({
      id: memoryId,
      userId,
      content: 'delete me',
      tags: ['x'],
      metadata: null,
      type: 'long-term',
      scope: null,
      organizationId: null,
      expiresAt: null,
      version: 1,
    });
    svc.deleteMemory.mockResolvedValue(true);

    await controller.deleteMemory({ userId, memoryId }, ctx);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        before: expect.objectContaining({ content: 'delete me' }),
        after: { deleted: true },
        // Delegation facts travel in `context`, which the audit service maps to
        // the row's `delegated`/`actorType` columns.
        context: ctx,
      }),
    );
  });

  it('records the attempt even when the delete found nothing (deleted:false)', async () => {
    svc.getMemory.mockResolvedValue(null);
    svc.deleteMemory.mockResolvedValue(false);

    await controller.deleteMemory({ userId, memoryId }, ctx);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        before: null,
        after: { deleted: false },
      }),
    );
  });

  it('restore_memory rebuilds from the newest delete snapshot and records a restore row', async () => {
    audit.findLatestDeleteSnapshot.mockResolvedValue({
      before: {
        content: 'recover me',
        tags: ['x'],
        type: 'long-term',
        scope: null,
      },
      scope: null,
      organizationId: null,
    });
    svc.restoreMemory.mockResolvedValue({
      id: memoryId,
      userId,
      content: 'recover me',
      scope: null,
      organizationId: null,
    });

    const response = await controller.restoreMemory({ userId, memoryId }, ctx);

    expect(svc.restoreMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: memoryId,
        content: 'recover me',
        type: 'long-term',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restore', memoryId }),
    );
    expect(response.content[0]?.text).toContain(memoryId);
  });

  it('restore_memory fails clearly when there is no recoverable snapshot', async () => {
    audit.findLatestDeleteSnapshot.mockResolvedValue(null);
    await expect(
      controller.restoreMemory({ userId, memoryId }, ctx),
    ).rejects.toThrow(/No recoverable delete snapshot/);
  });

  it('get_memory_audit returns the history from the audit service', async () => {
    audit.list.mockResolvedValue([
      {
        id: 'a1',
        action: 'delete',
        actorType: 'api-key',
        actorLabel: null,
        delegated: false,
      },
    ]);
    const response = await controller.getMemoryAudit({
      userId,
      memoryId,
      limit: 10,
    });
    const parsed = JSON.parse(response.content[0]!.text) as {
      entries: unknown[];
    };
    expect(parsed.entries).toHaveLength(1);
    expect(audit.list).toHaveBeenCalledWith(userId, memoryId, 10);
  });

  it('registers restore_memory + get_memory_audit as delegable tools with correct scopes', () => {
    const tools = controller.getMcpTools();
    const restore = tools.find((t) => t.name === 'restore_memory');
    const history = tools.find((t) => t.name === 'get_memory_audit');
    expect(restore?.delegable).toBe(true);
    expect(restore?.requiredScope).toBe('memories:write');
    expect(history?.delegable).toBe(true);
    expect(history?.requiredScope).toBe('memories:read');
  });

  it('registers bulk_delete_memories as a delegable memories:delete tool (WP2 T6)', () => {
    const tool = controller
      .getMcpTools()
      .find((t) => t.name === 'bulk_delete_memories');
    expect(tool?.delegable).toBe(true);
    expect(tool?.requiredScope).toBe('memories:delete');
  });

  it('bulk delete returns a per-item report and audits each deleted id (WP2 T6)', async () => {
    svc.getMemory.mockResolvedValue({
      id: 'x',
      userId,
      content: 'c',
      tags: [],
      metadata: null,
      type: 'long-term',
      scope: null,
      organizationId: null,
      expiresAt: null,
      version: 1,
    });
    svc.bulkDeleteMemories.mockResolvedValue({
      deleted: ['a', 'b'],
      failed: [{ id: 'c', reason: 'not-found' }],
    });

    const response = await controller.bulkDeleteMemories(
      { userId, memoryIds: ['a', 'b', 'c'], actorLabel: 'op@example.com' },
      ctx,
    );

    const parsed = JSON.parse(response.content[0]!.text) as {
      deletedCount: number;
      failedCount: number;
    };
    expect(parsed.deletedCount).toBe(2);
    expect(parsed.failedCount).toBe(1);
    // One bulk-delete audit row per successfully deleted id.
    const bulkRows = audit.record.mock.calls.filter(
      (c) => (c[0] as { action: string }).action === 'bulk-delete',
    );
    expect(bulkRows).toHaveLength(2);
  });

  it('de-duplicates ids before snapshotting so each unique target is read once (PR #222)', async () => {
    svc.getMemory.mockResolvedValue({
      id: 'x',
      userId,
      content: 'c',
      tags: [],
      metadata: null,
      type: 'long-term',
      scope: null,
      organizationId: null,
      expiresAt: null,
      version: 1,
    });
    svc.bulkDeleteMemories.mockResolvedValue({
      deleted: ['a', 'b'],
      failed: [],
    });

    await controller.bulkDeleteMemories(
      { userId, memoryIds: ['a', 'a', 'b', 'b', 'a'] },
      ctx,
    );

    // snapshotOf → memoryService.getMemory: one read per UNIQUE id (a, b), not
    // once per (duplicated) input id.
    expect(svc.getMemory).toHaveBeenCalledTimes(2);
  });
});
