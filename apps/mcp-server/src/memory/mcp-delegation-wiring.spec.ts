/**
 * Wiring test for issue #200: binds the delegation security contract to the
 * REAL identity-mode memory tools (`recall`/`update_memory`/`delete_memory`),
 * not a synthetic echo tool. The core dispatch tests prove the mechanism; this
 * proves the mechanism is wired to the tools that matter. It guards against a
 * refactor that would silently regress tenant isolation with every other test
 * still green — e.g. setting `auth: 'admin'` on recall, dropping `delegable`,
 * or nesting/renaming `userId` in a DTO so the dispatch stops injecting it.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools, type Tool } from '@engram/core';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';

// Two distinct, valid CUIDs (userIdSchema accepts cuid()/cuid2()); arbitrary
// strings like 'other-tenant' would fail the real recall schema's validation.
const KEY_TENANT = 'cjld2cjxh0000qzrmn831i7rn';
const OTHER_TENANT = 'cjld2cyuq0000t3rmniod1foy';

type CallRequest = {
  method: string;
  params: { name: string; arguments?: unknown };
};
type CallExtra = {
  authInfo?: { scopes?: string[]; extra?: Record<string, unknown> };
};
type CallResult = { content: Array<{ text: string }>; isError?: boolean };
type CallHandler = (
  request: CallRequest,
  extra?: CallExtra,
) => Promise<CallResult>;

const getRequestMethod = (schema: unknown): string | undefined =>
  (schema as { def?: { shape?: { method?: { def?: { values?: string[] } } } } })
    ?.def?.shape?.method?.def?.values?.[0];

describe('MCP delegation wiring — real memory tools (#200)', () => {
  let controller: MemoryController;

  const mockMemoryService = {
    createMemory: jest.fn(),
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
  const mockConsolidationService = { run: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.MCP_ADMIN_TOKEN = 'test-admin-token-12345';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: ReindexQueueService, useValue: mockReindexQueueService },
        { provide: ConsolidationService, useValue: mockConsolidationService },
      ],
    }).compile();

    controller = module.get<MemoryController>(MemoryController);
  });

  const tool = (name: string): Tool => {
    const found = controller.getMcpTools().find((t) => t.name === name);
    if (!found) throw new Error(`tool ${name} not registered`);
    return found;
  };

  describe('metadata contract', () => {
    it.each(['recall', 'update_memory', 'delete_memory'])(
      '%s is identity-mode and opts into delegation',
      (name) => {
        const t = tool(name);
        // Identity mode (the default): the tenant boundary is the token, not the
        // request body. If this ever became 'admin', a client-supplied userId
        // would pass through untouched for EVERY principal — a cross-tenant leak.
        expect(t.auth ?? 'identity').toBe('identity');
        // Opted into delegation so an admin-scoped operator console can act on
        // behalf of any data owner. Dropping this silently re-pins the console.
        expect(t.delegable).toBe(true);
      },
    );
  });

  describe('end-to-end delegation through registerTools', () => {
    const capture = (t: Tool): CallHandler => {
      const server = new Server(
        { name: 'wiring', version: '0.0.0' },
        { capabilities: { tools: {} } },
      );
      let captured: CallHandler | undefined;
      jest
        .spyOn(server, 'setRequestHandler')
        .mockImplementation((schema, fn): void => {
          if (getRequestMethod(schema) === 'tools/call') {
            captured = fn as unknown as CallHandler;
          }
        });
      registerTools(server, [t], { required: true });
      if (!captured) throw new Error('tools/call handler was not registered');
      return captured;
    };

    it('honours an admin-scoped key delegating recall to another tenant', async () => {
      mockMemoryService.recall.mockResolvedValue([]);
      const call = capture(tool('recall'));
      await call(
        {
          method: 'tools/call',
          params: {
            name: 'recall',
            arguments: { userId: OTHER_TENANT, query: 'hi' },
          },
        },
        { authInfo: { scopes: ['admin'], extra: { userId: KEY_TENANT } } },
      );
      expect(mockMemoryService.recall).toHaveBeenCalledWith(
        OTHER_TENANT,
        'hi',
        expect.anything(),
      );
    });

    it('pins a non-admin key back to its own tenant on recall', async () => {
      // This is the load-bearing assertion: it only holds if the dispatch both
      // DETECTS recall's userId schema and OVERWRITES the forged tenant. A
      // refactor that broke either would surface the client's OTHER_TENANT here.
      mockMemoryService.recall.mockResolvedValue([]);
      const call = capture(tool('recall'));
      await call(
        {
          method: 'tools/call',
          params: {
            name: 'recall',
            arguments: { userId: OTHER_TENANT, query: 'hi' },
          },
        },
        {
          authInfo: {
            scopes: ['memories:read'],
            extra: { userId: KEY_TENANT },
          },
        },
      );
      expect(mockMemoryService.recall).toHaveBeenCalledWith(
        KEY_TENANT,
        'hi',
        expect.anything(),
      );
    });
  });
});
