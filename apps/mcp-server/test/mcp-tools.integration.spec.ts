import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { MemoryController } from '../src/memory/memory.controller';
import { MemoryService } from '../src/memory/memory.service';
import { ReindexQueueService } from '../src/memory/reindex-queue.service';
import { ConsolidationService } from '../src/memory/consolidation.service';
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
// Valid CUID identifiers for Zod .cuid() validation (starts with 'c', ≥8 extra chars)
// ---------------------------------------------------------------------------
const USER_ID = 'cjld2cyuq0000t3rmniod1foy';
const MEMORY_ID = 'cjld2cjxh0000qzrmn831i7rn';
const MEMORY_ID_2 = 'cjld2cjxh0001qzrmn831i7rp';
const ADMIN_TOKEN = 'integration-admin-token-12345';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const makeStmMemory = (overrides: Partial<StmMemory> = {}): StmMemory => ({
  id: MEMORY_ID,
  userId: USER_ID,
  content: 'STM tool test content',
  metadata: null,
  tags: ['tool-test'],
  embedding: [],
  type: 'short-term',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date(Date.now() + 3600 * 1000),
  ttl: 3600,
  accessCount: 0,
  version: 1,
  ...overrides,
});

const makeLtmMemory = (overrides: Partial<LtmMemory> = {}): LtmMemory => ({
  id: MEMORY_ID,
  userId: USER_ID,
  content: 'LTM tool test content',
  metadata: null,
  tags: ['tool-test'],
  embedding: [],
  type: 'long-term',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
  version: 1,
  ...overrides,
});

type PaginatedFixture<T> = {
  items: T[];
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
};

const emptyPaginated = <T>(): PaginatedFixture<T> => ({
  items: [] as T[],
  totalCount: 0,
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: undefined,
  endCursor: undefined,
});

type ToolTextResponse = { content: Array<{ type: string; text: string }> };
type MemoryResponsePayload = { id: string; type: string };
type ListResponsePayload = {
  memories: unknown[];
  pagination: {
    totalCount: number;
    hasNextPage: boolean;
  };
};

/** Extract text from a tool response */
const text = (response: ToolTextResponse): string => {
  const firstContent = response.content[0];

  if (!firstContent) {
    throw new Error('Tool response did not include text content');
  }

  return firstContent.text;
};

const parseToolResponse = <T>(response: ToolTextResponse): T => {
  return JSON.parse(text(response)) as T;
};

/**
 * Human-readable prose from a tool response. get_memory (not-found) and
 * delete_memory now put machine-readable JSON first and keep the sentence as a
 * second content item (WP2 T2/D2), so the prose is the last text item.
 */
const prose = (response: ToolTextResponse): string =>
  response.content[response.content.length - 1]?.text ?? '';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('MCP Tools Integration', () => {
  let controller: MemoryController;
  let stmService: jest.Mocked<MemoryStmService>;
  let ltmService: jest.Mocked<MemoryLtmService>;
  let reindexQueue: jest.Mocked<ReindexQueueService>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  beforeEach(async () => {
    process.env.MCP_ADMIN_TOKEN = ADMIN_TOKEN;

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
      reindex: jest.fn(),
      semanticSearch: jest.fn().mockResolvedValue([]),
    };

    const queueMock: Partial<jest.Mocked<ReindexQueueService>> = {
      enqueue: jest.fn(),
      get: jest.fn(),
      cancel: jest.fn(),
      retry: jest.fn(),
    };

    const consolidationMock: Partial<jest.Mocked<ConsolidationService>> = {
      run: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [
        MemoryService,
        { provide: MemoryStmService, useValue: stmMock },
        { provide: MemoryLtmService, useValue: ltmMock },
        { provide: ReindexQueueService, useValue: queueMock },
        { provide: ConsolidationService, useValue: consolidationMock },
      ],
    }).compile();

    controller = module.get<MemoryController>(MemoryController);
    stmService = module.get<jest.Mocked<MemoryStmService>>(MemoryStmService);
    ltmService = module.get<jest.Mocked<MemoryLtmService>>(MemoryLtmService);
    reindexQueue =
      module.get<jest.Mocked<ReindexQueueService>>(ReindexQueueService);
  });

  // -------------------------------------------------------------------------
  // Tool registration
  // -------------------------------------------------------------------------
  describe('getMcpTools() registration', () => {
    it('should register exactly 23 tools', () => {
      const tools = controller.getMcpTools();
      expect(tools).toHaveLength(23);
    });

    it('should register all expected tool names', () => {
      const names = controller.getMcpTools().map((t) => t.name);
      expect(names).toContain('create_memory');
      expect(names).toContain('get_memory');
      expect(names).toContain('list_memories');
      expect(names).toContain('update_memory');
      expect(names).toContain('delete_memory');
      expect(names).toContain('promote_memory');
      expect(names).toContain('recall');
      expect(names).toContain('reindex_memories');
      expect(names).toContain('queue_reindex_memories');
      expect(names).toContain('get_reindex_status');
      expect(names).toContain('cancel_reindex_job');
      expect(names).toContain('retry_reindex_job');
      expect(names).toContain('consolidate_memories');
      // C1 tools
      expect(names).toContain('remember');
      expect(names).toContain('forget');
      expect(names).toContain('reflect');
      expect(names).toContain('compress_context');
      expect(names).toContain('load_context');
      // C2 tools
      expect(names).toContain('ingest_conversation');
      // C3 tools
      expect(names).toContain('prompt_context');
    });

    it('should attach a callable handler to each tool', () => {
      const tools = controller.getMcpTools();
      tools.forEach((tool) => {
        expect(typeof tool.handler).toBe('function');
      });
    });

    it('should return tools with an inputSchema on each tool', () => {
      const tools = controller.getMcpTools();
      tools.forEach((tool) => {
        expect(tool.inputSchema).toBeDefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // create_memory
  // -------------------------------------------------------------------------
  describe('create_memory tool', () => {
    it('should create a short-term memory and return its ID', async () => {
      const memory = makeStmMemory();
      stmService.create.mockResolvedValue(memory);

      const response = await controller.createMemory({
        userId: USER_ID,
        content: 'STM tool test content',
        type: 'short-term',
        ttl: 3600,
      });

      expect(text(response)).toBe(
        `Created short-term memory with ID: ${MEMORY_ID}`,
      );
    });

    it('should create a long-term memory and return its ID', async () => {
      const memory = makeLtmMemory();
      ltmService.create.mockResolvedValue(memory);

      const response = await controller.createMemory({
        userId: USER_ID,
        content: 'LTM tool test content',
        type: 'long-term',
      });

      expect(text(response)).toBe(
        `Created long-term memory with ID: ${MEMORY_ID}`,
      );
    });

    it('should throw wrapped error for invalid userId (non-CUID)', async () => {
      await expect(
        controller.createMemory({
          userId: 'not-a-cuid',
          content: 'Test content',
          type: 'short-term',
        }),
      ).rejects.toThrow('Failed to create memory');
    });

    it('should throw wrapped error for empty content', async () => {
      await expect(
        controller.createMemory({
          userId: USER_ID,
          content: '',
          type: 'short-term',
        }),
      ).rejects.toThrow('Failed to create memory');
    });

    it('should throw wrapped error for content exceeding max length', async () => {
      await expect(
        controller.createMemory({
          userId: USER_ID,
          content: 'x'.repeat(10241),
          type: 'short-term',
        }),
      ).rejects.toThrow('Failed to create memory');
    });

    it('should throw wrapped error when service fails', async () => {
      stmService.create.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        controller.createMemory({
          userId: USER_ID,
          content: 'Test content',
          type: 'short-term',
        }),
      ).rejects.toThrow(
        'Failed to create memory: an internal error occurred (details are in the server logs)',
      );
    });

    it('should create memory with tags and metadata', async () => {
      const memory = makeStmMemory({
        tags: ['work', 'important'],
        metadata: { priority: 'high' },
      });
      stmService.create.mockResolvedValue(memory);

      const response = await controller.createMemory({
        userId: USER_ID,
        content: 'STM tool test content',
        type: 'short-term',
        tags: ['work', 'important'],
        metadata: { priority: 'high' },
        ttl: 7200,
      });

      expect(text(response)).toContain('short-term');
      expect(stmService.create).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['work', 'important'] }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // get_memory
  // -------------------------------------------------------------------------
  describe('get_memory tool', () => {
    it('should return memory JSON when found in STM', async () => {
      const memory = makeStmMemory();
      stmService.findById.mockResolvedValue(memory);

      const response = await controller.getMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      });

      const parsed = parseToolResponse<MemoryResponsePayload>(response);
      expect(parsed.id).toBe(MEMORY_ID);
      expect(parsed.type).toBe('short-term');
    });

    it('should return memory JSON when found via LTM fallback', async () => {
      const memory = makeLtmMemory();
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError(MEMORY_ID),
      );
      ltmService.get.mockResolvedValue(memory);

      const response = await controller.getMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      });

      const parsed = parseToolResponse<MemoryResponsePayload>(response);
      expect(parsed.id).toBe(MEMORY_ID);
      expect(parsed.type).toBe('long-term');
    });

    it('should return not-found message when memory does not exist', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError(MEMORY_ID),
      );
      ltmService.get.mockRejectedValue(new LtmMemoryNotFoundError(MEMORY_ID));

      const response = await controller.getMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      });

      expect(prose(response)).toBe(`Memory ${MEMORY_ID} not found`);
    });

    it('should throw wrapped error for invalid memoryId', async () => {
      await expect(
        controller.getMemory({
          userId: USER_ID,
          memoryId: 'not-a-cuid',
        }),
      ).rejects.toThrow('Failed to get memory');
    });

    it('should throw wrapped error for invalid userId', async () => {
      await expect(
        controller.getMemory({
          userId: 'bad-user',
          memoryId: MEMORY_ID,
        }),
      ).rejects.toThrow('Failed to get memory');
    });
  });

  // -------------------------------------------------------------------------
  // list_memories
  // -------------------------------------------------------------------------
  describe('list_memories tool', () => {
    it('should return paginated JSON with memories array', async () => {
      const stmMemory = makeStmMemory({ id: 'stm-list-001' });
      const ltmMemory = makeLtmMemory({ id: 'ltm-list-001' });

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

      const response = await controller.listMemories({ userId: USER_ID });

      const parsed = parseToolResponse<ListResponsePayload>(response);
      expect(parsed).toHaveProperty('memories');
      expect(parsed).toHaveProperty('pagination');
      expect(parsed.memories).toHaveLength(2);
      expect(parsed.pagination.totalCount).toBe(2);
    });

    it('should return empty memories array when no memories exist', async () => {
      stmService.list.mockResolvedValue(emptyPaginated<StmMemory>());
      ltmService.list.mockResolvedValue(emptyPaginated<LtmMemory>());

      const response = await controller.listMemories({ userId: USER_ID });

      const parsed = parseToolResponse<ListResponsePayload>(response);
      expect(parsed.memories).toHaveLength(0);
      expect(parsed.pagination.totalCount).toBe(0);
      expect(parsed.pagination.hasNextPage).toBe(false);
    });

    it('should respect the limit parameter', async () => {
      stmService.list.mockResolvedValue(emptyPaginated<StmMemory>());
      ltmService.list.mockResolvedValue({
        items: Array.from({ length: 3 }, (_, i) =>
          makeLtmMemory({ id: `ltm-paged-${i}` }),
        ),
        totalCount: 3,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const response = await controller.listMemories({
        userId: USER_ID,
        limit: 10,
      });

      const parsed = parseToolResponse<ListResponsePayload>(response);
      expect(parsed.memories).toHaveLength(3);
    });

    it('should throw wrapped error for invalid userId', async () => {
      await expect(controller.listMemories({ userId: 'bad' })).rejects.toThrow(
        'Failed to list memories',
      );
    });
  });

  // -------------------------------------------------------------------------
  // update_memory
  // -------------------------------------------------------------------------
  describe('update_memory tool', () => {
    it('should update STM memory and return updated content', async () => {
      const original = makeStmMemory();
      const updated = makeStmMemory({ content: 'Updated STM content' });
      stmService.findById.mockResolvedValue(original);
      stmService.update.mockResolvedValue(updated);

      const response = await controller.updateMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
        content: 'Updated STM content',
      });

      expect(text(response)).toContain(`Updated memory ${MEMORY_ID}`);
      expect(text(response)).toContain('Updated STM content');
    });

    it('should update LTM memory via fallback path', async () => {
      const original = makeLtmMemory();
      const updated = makeLtmMemory({ content: 'Updated LTM content' });
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError(MEMORY_ID),
      );
      ltmService.get.mockResolvedValue(original);
      ltmService.update.mockResolvedValue(updated);

      const response = await controller.updateMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
        content: 'Updated LTM content',
      });

      expect(text(response)).toContain(`Updated memory ${MEMORY_ID}`);
    });

    it('should throw wrapped error for invalid userId', async () => {
      await expect(
        controller.updateMemory({
          userId: 'bad-user',
          memoryId: MEMORY_ID,
          content: 'New content',
        }),
      ).rejects.toThrow('Failed to update memory');
    });

    it('should throw wrapped error when memory not found', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError(MEMORY_ID),
      );
      ltmService.get.mockResolvedValue(null);

      await expect(
        controller.updateMemory({
          userId: USER_ID,
          memoryId: MEMORY_ID,
          content: 'New content',
        }),
      ).rejects.toThrow('Failed to update memory');
    });
  });

  // -------------------------------------------------------------------------
  // delete_memory
  // -------------------------------------------------------------------------
  describe('delete_memory tool', () => {
    it('should return success message when memory deleted from STM', async () => {
      stmService.delete.mockResolvedValue(undefined);
      ltmService.delete.mockResolvedValue(false);

      const response = await controller.deleteMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      });

      expect(prose(response)).toBe(`Successfully deleted memory ${MEMORY_ID}`);
    });

    it('should return success message when memory deleted from LTM', async () => {
      stmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError(MEMORY_ID),
      );
      ltmService.delete.mockResolvedValue(true);

      const response = await controller.deleteMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      });

      expect(prose(response)).toBe(`Successfully deleted memory ${MEMORY_ID}`);
    });

    it('should return not-found message when memory does not exist in either store', async () => {
      stmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError(MEMORY_ID),
      );
      ltmService.delete.mockResolvedValue(false);

      const response = await controller.deleteMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      });

      expect(prose(response)).toBe(`Memory ${MEMORY_ID} not found`);
    });

    it('should throw wrapped error for invalid userId', async () => {
      await expect(
        controller.deleteMemory({
          userId: 'INVALID!',
          memoryId: MEMORY_ID,
        }),
      ).rejects.toThrow('Failed to delete memory');
    });

    it('should throw wrapped error when service throws unexpected error', async () => {
      stmService.delete.mockRejectedValue(new Error('Redis connection failed'));

      await expect(
        controller.deleteMemory({
          userId: USER_ID,
          memoryId: MEMORY_ID,
        }),
      ).rejects.toThrow(
        'Failed to delete memory: an internal error occurred (details are in the server logs)',
      );
    });
  });

  // -------------------------------------------------------------------------
  // promote_memory
  // -------------------------------------------------------------------------
  describe('promote_memory tool', () => {
    it('should return success message with promoted memory ID', async () => {
      const promoted = makeLtmMemory({ id: MEMORY_ID_2 });
      ltmService.promote.mockResolvedValue(promoted);

      const response = await controller.promoteMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      });

      expect(text(response)).toContain(
        `Successfully promoted memory ${MEMORY_ID_2} to long-term storage`,
      );
    });

    it('should include promoted memory JSON in the response', async () => {
      const promoted = makeLtmMemory({
        content: 'Promoted content',
        tags: ['promoted'],
      });
      ltmService.promote.mockResolvedValue(promoted);

      const response = await controller.promoteMemory({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      });

      expect(text(response)).toContain('Promoted content');
    });

    it('should throw wrapped error when STM memory not found', async () => {
      ltmService.promote.mockRejectedValue(
        new LtmMemoryNotFoundError(MEMORY_ID),
      );

      await expect(
        controller.promoteMemory({
          userId: USER_ID,
          memoryId: MEMORY_ID,
        }),
      ).rejects.toThrow('Failed to promote memory');
    });

    it('should throw wrapped error for invalid userId', async () => {
      await expect(
        controller.promoteMemory({
          userId: 'bad-user',
          memoryId: MEMORY_ID,
        }),
      ).rejects.toThrow('Failed to promote memory');
    });
  });

  // -------------------------------------------------------------------------
  // Handlers registered via getMcpTools() are callable
  // -------------------------------------------------------------------------
  describe('tool handlers via getMcpTools()', () => {
    it('create_memory handler should work when called via registered handler', async () => {
      const memory = makeStmMemory();
      stmService.create.mockResolvedValue(memory);

      const tools = controller.getMcpTools();
      const createTool = tools.find((t) => t.name === 'create_memory')!;

      const response = (await createTool.handler({
        userId: USER_ID,
        content: 'Test via handler',
        type: 'short-term',
      })) as { content: Array<{ type: string; text: string }> };

      expect(text(response)).toContain('Created short-term memory');
    });

    it('get_memory handler should return not-found when memory absent', async () => {
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError(MEMORY_ID),
      );
      ltmService.get.mockRejectedValue(new LtmMemoryNotFoundError(MEMORY_ID));

      const tools = controller.getMcpTools();
      const getTool = tools.find((t) => t.name === 'get_memory')!;

      const response = (await getTool.handler({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      })) as { content: Array<{ type: string; text: string }> };

      expect(prose(response)).toBe(`Memory ${MEMORY_ID} not found`);
    });

    it('delete_memory handler should return success message', async () => {
      stmService.delete.mockResolvedValue(undefined);
      ltmService.delete.mockResolvedValue(false);

      const tools = controller.getMcpTools();
      const deleteTool = tools.find((t) => t.name === 'delete_memory')!;

      const response = (await deleteTool.handler({
        userId: USER_ID,
        memoryId: MEMORY_ID,
      })) as { content: Array<{ type: string; text: string }> };

      expect(prose(response)).toBe(`Successfully deleted memory ${MEMORY_ID}`);
    });

    it('list_memories handler should return paginated response', async () => {
      stmService.list.mockResolvedValue(emptyPaginated<StmMemory>());
      ltmService.list.mockResolvedValue(emptyPaginated<LtmMemory>());

      const tools = controller.getMcpTools();
      const listTool = tools.find((t) => t.name === 'list_memories')!;

      const response = (await listTool.handler({
        userId: USER_ID,
      })) as ToolTextResponse;

      const parsed = parseToolResponse<ListResponsePayload>(response);
      expect(parsed).toHaveProperty('memories');
      expect(parsed).toHaveProperty('pagination');
    });

    it('reindex_memories handler should reject missing adminToken', async () => {
      const tools = controller.getMcpTools();
      const reindexTool = tools.find((t) => t.name === 'reindex_memories');

      await expect(
        reindexTool?.handler({
          batchSize: 100,
        }),
      ).rejects.toThrow('Failed to reindex memories');
    });

    it('reindex_memories handler should reject wrong adminToken', async () => {
      const tools = controller.getMcpTools();
      const reindexTool = tools.find((t) => t.name === 'reindex_memories');

      await expect(
        reindexTool?.handler({
          adminToken: 'wrong-admin-token-12345',
          batchSize: 100,
        }),
      ).rejects.toThrow(
        'Failed to reindex memories: Unauthorized maintenance operation',
      );
    });

    it('queue/cancel/retry/status handlers should work with valid admin token', async () => {
      reindexQueue.enqueue.mockResolvedValue({
        jobId: '29ee5b69-9261-47a9-8f2d-14b95beac718',
        state: 'queued',
        createdAt: new Date().toISOString(),
        options: { batchSize: 100 },
        summary: {
          processed: 0,
          indexed: 0,
          skipped: 0,
          failed: 0,
          cursor: null,
        },
        events: [],
      });
      reindexQueue.get.mockResolvedValue({
        jobId: '29ee5b69-9261-47a9-8f2d-14b95beac718',
        state: 'running',
        createdAt: new Date().toISOString(),
        options: { batchSize: 100 },
        summary: {
          processed: 10,
          indexed: 10,
          skipped: 0,
          failed: 0,
          cursor: 'c10',
        },
        events: [],
      });
      reindexQueue.cancel.mockResolvedValue({
        jobId: '29ee5b69-9261-47a9-8f2d-14b95beac718',
        state: 'cancelled',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        terminalReason: 'cancelled_by_request',
        options: { batchSize: 100 },
        summary: {
          processed: 10,
          indexed: 10,
          skipped: 0,
          failed: 0,
          cursor: 'c10',
        },
        events: [],
      });
      reindexQueue.retry.mockResolvedValue({
        jobId: '65d852b0-d40f-4dfd-b4f9-bb7b597f44ef',
        state: 'queued',
        createdAt: new Date().toISOString(),
        retryOfJobId: '29ee5b69-9261-47a9-8f2d-14b95beac718',
        options: { batchSize: 100, cursor: 'c10' },
        summary: {
          processed: 0,
          indexed: 0,
          skipped: 0,
          failed: 0,
          cursor: 'c10',
        },
        events: [],
      });

      const tools = controller.getMcpTools();
      const queueTool = tools.find((t) => t.name === 'queue_reindex_memories');
      const statusTool = tools.find((t) => t.name === 'get_reindex_status');
      const cancelTool = tools.find((t) => t.name === 'cancel_reindex_job');
      const retryTool = tools.find((t) => t.name === 'retry_reindex_job');

      const queued = (await queueTool?.handler({
        adminToken: ADMIN_TOKEN,
        batchSize: 100,
      })) as ToolTextResponse;
      expect(parseToolResponse<{ state: string }>(queued).state).toBe('queued');

      const status = (await statusTool?.handler({
        adminToken: ADMIN_TOKEN,
        jobId: '29ee5b69-9261-47a9-8f2d-14b95beac718',
      })) as ToolTextResponse;
      expect(parseToolResponse<{ state: string }>(status).state).toBe(
        'running',
      );

      const cancelled = (await cancelTool?.handler({
        adminToken: ADMIN_TOKEN,
        jobId: '29ee5b69-9261-47a9-8f2d-14b95beac718',
      })) as ToolTextResponse;
      expect(parseToolResponse<{ state: string }>(cancelled).state).toBe(
        'cancelled',
      );

      const retried = (await retryTool?.handler({
        adminToken: ADMIN_TOKEN,
        jobId: '29ee5b69-9261-47a9-8f2d-14b95beac718',
      })) as ToolTextResponse;
      expect(parseToolResponse<{ state: string }>(retried).state).toBe(
        'queued',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent operations
  // -------------------------------------------------------------------------
  describe('concurrent operations', () => {
    it('should handle 10 simultaneous create_memory calls', async () => {
      stmService.create.mockImplementation((dto) =>
        Promise.resolve(
          makeStmMemory({
            id: `stm-concurrent-${Date.now()}`,
            content: dto.content,
          }),
        ),
      );

      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          controller.createMemory({
            userId: USER_ID,
            content: `Concurrent content ${i}`,
            type: 'short-term',
          }),
        ),
      );

      expect(responses).toHaveLength(10);
      responses.forEach((r) => {
        expect(text(r)).toContain('Created short-term memory');
      });
      expect(stmService.create).toHaveBeenCalledTimes(10);
    });

    it('should handle mixed read/write concurrency without data races', async () => {
      const memory = makeStmMemory();
      stmService.create.mockResolvedValue(memory);
      stmService.findById.mockResolvedValue(memory);
      stmService.delete.mockResolvedValue(undefined);
      ltmService.delete.mockResolvedValue(false);

      const [createResp, getResp, deleteResp] = await Promise.all([
        controller.createMemory({
          userId: USER_ID,
          content: 'Content',
          type: 'short-term',
        }),
        controller.getMemory({ userId: USER_ID, memoryId: MEMORY_ID }),
        controller.deleteMemory({ userId: USER_ID, memoryId: MEMORY_ID }),
      ]);

      expect(text(createResp)).toContain('Created short-term memory');
      expect(text(getResp)).toContain(MEMORY_ID);
      expect(prose(deleteResp)).toBe(
        `Successfully deleted memory ${MEMORY_ID}`,
      );
    });
  });

  // -------------------------------------------------------------------------
  // prompt_context
  // -------------------------------------------------------------------------
  describe('prompt_context tool', () => {
    it('should return a context block and token metadata', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        {
          memory: makeLtmMemory({ content: 'NestJS uses DI throughout' }),
          score: 0.9,
        },
      ]);

      const response = await controller.promptContext({
        userId: USER_ID,
        query: 'dependency injection',
        tokenBudget: 2000,
      });

      const contextText = response.content[0]!.text;
      expect(contextText).toContain('NestJS uses DI throughout');

      const meta = JSON.parse(response.content[1]!.text) as {
        memoryCount: number;
        estimatedTokens: number;
        tokenBudget: number;
        truncated: boolean;
        candidatesFound: number;
      };
      expect(meta.memoryCount).toBe(1);
      expect(meta.tokenBudget).toBe(2000);
      expect(meta.estimatedTokens).toBeLessThanOrEqual(2000);
      expect(meta.truncated).toBe(false);
      expect(meta.candidatesFound).toBe(1);
    });

    it('should return (no memories) when no hits pass minScore', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        { memory: makeLtmMemory(), score: 0.2 },
      ]);

      const response = await controller.promptContext({
        userId: USER_ID,
        query: 'very specific niche topic',
        tokenBudget: 500,
        minScore: 0.8,
      });

      expect(response.content[0]!.text).toBe('(no memories)');
    });

    it('should respect token budget when multiple memories are returned', async () => {
      const bigContent = 'a'.repeat(4000); // ~1000 tokens each
      ltmService.semanticSearch.mockResolvedValue(
        Array.from({ length: 5 }, () => ({
          memory: makeLtmMemory({ content: bigContent }),
          score: 0.85,
        })),
      );

      const response = await controller.promptContext({
        userId: USER_ID,
        query: 'large context',
        tokenBudget: 500,
      });

      const meta = JSON.parse(response.content[1]!.text) as {
        estimatedTokens: number;
        tokenBudget: number;
        truncated: boolean;
      };
      expect(meta.estimatedTokens).toBeLessThanOrEqual(meta.tokenBudget);
      expect(meta.truncated).toBe(true);
    });

    it('should throw wrapped error for invalid userId', async () => {
      await expect(
        controller.promptContext({
          userId: 'bad-user',
          query: 'some query',
        }),
      ).rejects.toThrow('Failed to assemble prompt context');
    });

    it('handler registered via getMcpTools() should be callable', async () => {
      ltmService.semanticSearch.mockResolvedValue([]);

      const tools = controller.getMcpTools();
      const tool = tools.find((t) => t.name === 'prompt_context')!;
      expect(tool).toBeDefined();
      expect(typeof tool.handler).toBe('function');

      const response = (await tool.handler({
        userId: USER_ID,
        query: 'test via handler',
      })) as { content: Array<{ type: string; text: string }> };

      expect(response.content[0]!.text).toBe('(no memories)');
    });
  });
});
