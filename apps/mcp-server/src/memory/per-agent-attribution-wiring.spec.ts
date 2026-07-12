/**
 * Wiring test for GAPS G1-T2 (per-agent attribution, STATE-G1-G4 Decision 7):
 * two agents holding DISTINCT API keys but the SAME tenant (`userId`) must
 * produce distinct `MemoryAudit.actorId` rows when they mutate memories.
 *
 * The chain under test is real end-to-end below the transport: the core
 * dispatch (`registerTools`) builds the verified ToolCallContext from
 * authInfo, the REAL `delete_memory` controller handler forwards it, and the
 * REAL MemoryAuditService derives `actorType`/`actorId` from
 * `context.apiKeyId`. Only Prisma and the memory stores are mocked. This
 * guards the provisioning story of `provision-agent-keys.cli.ts`: distinct
 * keys are what make per-agent attribution work — the shared pool stays one
 * `userId`, and an unkeyed call degrades to `anonymous`, never to a phantom
 * agent identity.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools, type Tool } from '@engram/core';
import type { PrismaService } from '@engram/database';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';
import { MemoryAuditService } from './memory-audit.service';

// Valid CUIDs — the real tool schemas validate userId/memoryId formats.
const SHARED_TENANT = 'cjld2cjxh0000qzrmn831i7rn';
const MEMORY_A = 'cjld2cyuq0000t3rmniod1foy';
const MEMORY_B = 'cjld2cyuq0001t3rmniod1foz';

const KEY_CLAUDE_CODE = 'key_agent_claude_code';
const KEY_CURSOR = 'key_agent_cursor';

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

describe('per-agent audit attribution wiring (G1-T2 / Decision 7)', () => {
  let controller: MemoryController;
  let auditCreate: jest.Mock;

  const mockMemoryService = {
    createMemory: jest.fn(),
    getMemory: jest.fn().mockResolvedValue(null),
    listMemories: jest.fn(),
    updateMemory: jest.fn(),
    deleteMemory: jest.fn().mockResolvedValue(true),
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
    mockMemoryService.getMemory.mockResolvedValue(null);
    mockMemoryService.deleteMemory.mockResolvedValue(true);

    // REAL audit service; only the Prisma boundary is mocked so we can read
    // the exact rows the audit trail would persist.
    auditCreate = jest.fn().mockResolvedValue({});
    const prismaMock = {
      memoryAudit: { create: auditCreate },
    } as unknown as PrismaService;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: ReindexQueueService, useValue: mockReindexQueueService },
        { provide: ConsolidationService, useValue: mockConsolidationService },
        {
          provide: MemoryAuditService,
          useValue: new MemoryAuditService(prismaMock),
        },
      ],
    }).compile();

    controller = module.get<MemoryController>(MemoryController);
  });

  const tool = (name: string): Tool => {
    const found = controller.getMcpTools().find((t) => t.name === name);
    if (!found) throw new Error(`tool ${name} not registered`);
    return found;
  };

  const capture = (t: Tool, required = true): CallHandler => {
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
    registerTools(server, [t], { required });
    if (!captured) throw new Error('tools/call handler was not registered');
    return captured;
  };

  const deleteAs = async (
    call: CallHandler,
    memoryId: string,
    apiKeyId: string,
  ): Promise<CallResult> =>
    call(
      {
        method: 'tools/call',
        params: {
          name: 'delete_memory',
          arguments: { userId: SHARED_TENANT, memoryId },
        },
      },
      {
        authInfo: {
          scopes: ['memories:delete'],
          extra: { userId: SHARED_TENANT, apiKeyId },
        },
      },
    );

  it('records DISTINCT actorIds for two agents keyed differently on ONE shared tenant', async () => {
    const call = capture(tool('delete_memory'));

    const first = await deleteAs(call, MEMORY_A, KEY_CLAUDE_CODE);
    const second = await deleteAs(call, MEMORY_B, KEY_CURSOR);

    // Both mutations really went through (a scope/auth failure would record
    // nothing and make the attribution assertions vacuous).
    expect(first.isError).toBeUndefined();
    expect(second.isError).toBeUndefined();
    expect(mockMemoryService.deleteMemory).toHaveBeenCalledTimes(2);

    expect(auditCreate).toHaveBeenCalledTimes(2);
    const rows = auditCreate.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );

    // The acceptance: two agents' ops record two different actorIds...
    expect(rows[0]).toMatchObject({
      actorType: 'api-key',
      actorId: KEY_CLAUDE_CODE,
      action: 'delete',
    });
    expect(rows[1]).toMatchObject({
      actorType: 'api-key',
      actorId: KEY_CURSOR,
      action: 'delete',
    });
    expect(rows[0]!.actorId).not.toBe(rows[1]!.actorId);

    // ...while the memory pool stays shared: ONE userId on both rows
    // (Decision 7 — no per-agent userIds).
    expect(rows[0]!.userId).toBe(SHARED_TENANT);
    expect(rows[1]!.userId).toBe(SHARED_TENANT);
  });

  it('degrades an unkeyed call to actorType=anonymous — attribution comes only from a verified key', async () => {
    // Auth optional so the call dispatches with no authInfo at all: this is
    // the shared-key/no-key posture the provisioning CLI exists to eliminate.
    const call = capture(tool('delete_memory'), false);

    const result = await call({
      method: 'tools/call',
      params: {
        name: 'delete_memory',
        arguments: { userId: SHARED_TENANT, memoryId: MEMORY_A },
      },
    });

    expect(result.isError).toBeUndefined();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const row = (
      auditCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(row.actorType).toBe('anonymous');
    expect(row.actorId).toBeNull();
  });
});
