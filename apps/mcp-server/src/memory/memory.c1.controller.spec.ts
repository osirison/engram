import { Test, TestingModule } from '@nestjs/testing';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';

const parseFirstText = (response: {
  content: Array<{ type: string; text: string }>;
}): string => {
  const first = response.content[0];
  if (!first) throw new Error('Empty response content');
  return first.text;
};

const parseFirstJson = <T>(response: {
  content: Array<{ type: string; text: string }>;
}): T => JSON.parse(parseFirstText(response)) as T;

describe('MemoryController — C1 High-Level Agent UX Tools', () => {
  let controller: MemoryController;

  const USER_ID = 'clm0000000000000000000000';
  const MEM_ID = 'clm1111111111111111111111';

  const mockMemoryService = {
    createMemory: jest.fn(),
    getMemory: jest.fn(),
    listMemories: jest.fn(),
    updateMemory: jest.fn(),
    deleteMemory: jest.fn(),
    promoteMemory: jest.fn(),
    recall: jest.fn(),
    reindex: jest.fn(),
    remember: jest.fn(),
    forget: jest.fn(),
    reflect: jest.fn(),
    compressContext: jest.fn(),
    loadContext: jest.fn(),
    ingestConversation: jest.fn(),
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

  it('should expose 19 MCP tools', () => {
    expect(controller.getMcpTools()).toHaveLength(19);
  });

  // ─── remember ───────────────────────────────────────────────────────────────

  describe('remember tool', () => {
    const baseInput = {
      userId: 'clm0000000000000000000000',
      content: 'TypeScript is structurally typed',
      type: 'auto' as const,
    };

    it('returns memoryId, resolvedType, and wasDeduped on success', async () => {
      mockMemoryService.remember.mockResolvedValue({
        memory: {
          id: MEM_ID,
          content: baseInput.content,
          type: 'long-term',
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: [],
          metadata: {},
          userId: USER_ID,
          embedding: [],
          expiresAt: null,
        },
        wasDeduped: false,
        resolvedType: 'long-term',
      });

      const response = await controller.remember(baseInput);
      const payload = parseFirstJson<{
        memoryId: string;
        resolvedType: string;
        wasDeduped: boolean;
      }>(response);

      expect(payload.memoryId).toBe(MEM_ID);
      expect(payload.resolvedType).toBe('long-term');
      expect(payload.wasDeduped).toBe(false);
    });

    it('throws on invalid input (missing userId)', async () => {
      await expect(
        controller.remember({ content: 'hello', userId: 'INVALID-USER' }),
      ).rejects.toThrow();
    });

    it('surfaces wasDeduped=true when LTM returns existing memory', async () => {
      mockMemoryService.remember.mockResolvedValue({
        memory: {
          id: MEM_ID,
          content: 'same',
          type: 'long-term',
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: [],
          metadata: { duplicateMatches: [{ memoryId: MEM_ID, score: 0.98 }] },
          userId: USER_ID,
          embedding: [],
          expiresAt: null,
        },
        wasDeduped: true,
        resolvedType: 'long-term',
      });

      const response = await controller.remember(baseInput);
      const payload = parseFirstJson<{ wasDeduped: boolean }>(response);
      expect(payload.wasDeduped).toBe(true);
    });
  });

  // ─── forget ─────────────────────────────────────────────────────────────────

  describe('forget tool', () => {
    it('returns dry-run candidates when confirm is false', async () => {
      mockMemoryService.forget.mockResolvedValue({
        candidates: [{ memoryId: MEM_ID, content: 'secret key', score: 0.9 }],
        deleted: 0,
        dryRun: true,
      });

      const response = await controller.forget({
        userId: USER_ID,
        query: 'secret key',
        confirm: false,
      });
      const payload = parseFirstJson<{
        dryRun: boolean;
        deleted: number;
        candidates: unknown[];
      }>(response);

      expect(payload.dryRun).toBe(true);
      expect(payload.deleted).toBe(0);
      expect(payload.candidates).toHaveLength(1);
    });

    it('returns deleted count when confirm is true', async () => {
      mockMemoryService.forget.mockResolvedValue({
        candidates: [{ memoryId: MEM_ID, content: 'secret key', score: 0.9 }],
        deleted: 1,
        dryRun: false,
      });

      const response = await controller.forget({
        userId: USER_ID,
        query: 'secret key',
        confirm: true,
      });
      const payload = parseFirstJson<{ dryRun: boolean; deleted: number }>(
        response,
      );

      expect(payload.dryRun).toBe(false);
      expect(payload.deleted).toBe(1);
    });

    it('throws on invalid input', async () => {
      await expect(controller.forget({ userId: USER_ID })).rejects.toThrow();
    });
  });

  // ─── reflect ────────────────────────────────────────────────────────────────

  describe('reflect tool', () => {
    it('returns structured reflection result', async () => {
      const mockResult = {
        query: 'database decisions',
        summary: 'Reflection on: "database decisions"\n…',
        themes: ['database', 'decision'],
        sourceIds: [MEM_ID, 'clm2222222222222222222222'],
        memoryCount: 2,
        dateRange: {
          earliest: '2025-01-01T00:00:00.000Z',
          latest: '2025-01-05T00:00:00.000Z',
        },
      };
      mockMemoryService.reflect.mockResolvedValue(mockResult);

      const response = await controller.reflect({
        userId: USER_ID,
        query: 'database decisions',
      });
      const payload = parseFirstJson<typeof mockResult>(response);

      expect(payload.memoryCount).toBe(2);
      expect(payload.themes).toContain('database');
      expect(payload.sourceIds).toEqual([MEM_ID, 'clm2222222222222222222222']);
    });

    it('throws on invalid input', async () => {
      await expect(controller.reflect({ userId: USER_ID })).rejects.toThrow();
    });
  });

  // ─── compress_context ────────────────────────────────────────────────────────

  describe('compress_context tool', () => {
    it('returns context text as first content item', async () => {
      mockMemoryService.compressContext.mockResolvedValue({
        context:
          '## Memory Context\n\n### [2025-01-01]\nUse Redis for caching\n',
        memoryCount: 1,
        truncated: false,
        charCount: 60,
      });

      const response = await controller.compressContext({
        userId: USER_ID,
        query: 'caching',
      });

      expect(response.content[0]!.text).toContain('Memory Context');
      const meta = JSON.parse(response.content[1]!.text) as {
        memoryCount: number;
        truncated: boolean;
      };
      expect(meta.memoryCount).toBe(1);
      expect(meta.truncated).toBe(false);
    });

    it('throws on invalid input', async () => {
      await expect(
        controller.compressContext({ userId: USER_ID }),
      ).rejects.toThrow();
    });
  });

  // ─── load_context ────────────────────────────────────────────────────────────

  describe('load_context tool', () => {
    it('returns session context block', async () => {
      mockMemoryService.loadContext.mockResolvedValue({
        context:
          '## Memory Context\n\n### [2025-06-01]\nDeployed to staging today\n',
        memoryCount: 1,
        truncated: false,
        charCount: 70,
      });

      const response = await controller.loadContext({ userId: USER_ID });

      expect(response.content[0]!.text).toContain('Memory Context');
      const meta = JSON.parse(response.content[1]!.text) as {
        memoryCount: number;
      };
      expect(meta.memoryCount).toBe(1);
    });

    it('throws on invalid input', async () => {
      await expect(
        controller.loadContext({ userId: 'invalid-not-cuid' }),
      ).rejects.toThrow();
    });
  });

  // ─── ingest_conversation ────────────────────────────────────────────────────

  describe('ingest_conversation tool', () => {
    const baseTurns = [
      { role: 'user', content: 'What is TypeScript?' },
      {
        role: 'assistant',
        content: 'TypeScript is a typed superset of JavaScript.',
      },
    ];

    it('returns ingested/skipped/failed counts and memoryIds on success', async () => {
      mockMemoryService.ingestConversation.mockResolvedValue({
        ingested: 2,
        skipped: 0,
        failed: 0,
        total: 2,
        memoryIds: [MEM_ID, 'clm2222222222222222222222'],
      });

      const response = await controller.ingestConversation({
        userId: USER_ID,
        turns: baseTurns,
      });
      const payload = parseFirstJson<{
        ingested: number;
        skipped: number;
        failed: number;
        total: number;
        memoryIds: string[];
      }>(response);

      expect(payload.ingested).toBe(2);
      expect(payload.skipped).toBe(0);
      expect(payload.failed).toBe(0);
      expect(payload.total).toBe(2);
      expect(payload.memoryIds).toHaveLength(2);
    });

    it('surfaces skipped count when duplicates are detected', async () => {
      mockMemoryService.ingestConversation.mockResolvedValue({
        ingested: 0,
        skipped: 2,
        failed: 0,
        total: 2,
        memoryIds: [MEM_ID, MEM_ID],
      });

      const response = await controller.ingestConversation({
        userId: USER_ID,
        turns: baseTurns,
      });
      const payload = parseFirstJson<{ skipped: number; total: number }>(
        response,
      );

      expect(payload.skipped).toBe(2);
      expect(payload.total).toBe(2);
    });

    it('throws on invalid input (missing turns)', async () => {
      await expect(
        controller.ingestConversation({ userId: USER_ID }),
      ).rejects.toThrow();
    });

    it('throws on invalid input (turns array is empty)', async () => {
      await expect(
        controller.ingestConversation({ userId: USER_ID, turns: [] }),
      ).rejects.toThrow();
    });

    it('throws on invalid userId', async () => {
      await expect(
        controller.ingestConversation({
          userId: 'not-a-cuid',
          turns: baseTurns,
        }),
      ).rejects.toThrow();
    });
  });
});
