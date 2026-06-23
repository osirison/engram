import { Test, TestingModule } from '@nestjs/testing';
import { MemoryService } from './memory.service';
import { MemoryStmService, StmMemoryNotFoundError } from '@engram/memory-stm';
import { MemoryLtmService, ImportanceScoringService } from '@engram/memory-ltm';
import type { LtmMemory } from '@engram/memory-ltm';
import type { Memory } from '@engram/database';

const USER_ID = 'clm0000000000000000000000';
const MEM_ID = 'clm1111111111111111111111';

const makeMemory = (overrides: Partial<LtmMemory> = {}): LtmMemory => ({
  id: MEM_ID,
  userId: USER_ID,
  content: 'Test memory content',
  metadata: {},
  tags: [],
  embedding: [],
  type: 'long-term',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  expiresAt: null,
  ...overrides,
});

describe('MemoryService — C1 High-Level Agent UX Methods', () => {
  let service: MemoryService;
  let ltmService: jest.Mocked<MemoryLtmService>;

  const mockStmService = {
    create: jest.fn(),
    findById: jest.fn().mockRejectedValue(new Error('not found')),
    update: jest.fn(),
    delete: jest.fn(),
    list: jest.fn().mockResolvedValue({ items: [], totalCount: 0 }),
  };

  const mockLtmService = {
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
    promote: jest.fn(),
    semanticSearch: jest.fn(),
    reindex: jest.fn(),
  };

  const mockImportanceService = {
    score: jest.fn().mockReturnValue({
      score: 0.7,
      status: 'active',
      factors: {},
      reasons: [],
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: MemoryStmService, useValue: mockStmService },
        { provide: MemoryLtmService, useValue: mockLtmService },
        { provide: ImportanceScoringService, useValue: mockImportanceService },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    ltmService = module.get(MemoryLtmService);
  });

  // ─── remember ───────────────────────────────────────────────────────────────

  describe('remember', () => {
    it('routes auto → long-term for factual content', async () => {
      const mem = makeMemory({ id: MEM_ID, type: 'long-term' });
      mockLtmService.create.mockResolvedValue(mem);

      const result = await service.remember({
        userId: USER_ID,
        content: 'TypeScript uses structural typing',
        type: 'auto',
        tags: [],
        skipDuplicateCheck: false,
      });

      expect(result.resolvedType).toBe('long-term');
      expect(result.wasDeduped).toBe(false);
      expect(result.memory.id).toBe(MEM_ID);
    });

    it('routes auto → short-term for temporal content', async () => {
      const stmMem = {
        ...makeMemory({ id: MEM_ID }),
        ttl: 3600,
      };
      mockStmService.create.mockResolvedValue(stmMem);

      const result = await service.remember({
        userId: USER_ID,
        content: 'Working on the auth module right now',
        type: 'auto',
        tags: [],
        skipDuplicateCheck: false,
      });

      expect(result.resolvedType).toBe('short-term');
    });

    it('forces long-term when type is explicit', async () => {
      const mem = makeMemory({ id: MEM_ID });
      mockLtmService.create.mockResolvedValue(mem);

      const result = await service.remember({
        userId: USER_ID,
        content: 'Working on the auth module right now',
        type: 'long-term',
        tags: [],
        skipDuplicateCheck: false,
      });

      expect(result.resolvedType).toBe('long-term');
    });

    it('detects dedupe annotation from metadata', async () => {
      const dupMem = makeMemory({
        metadata: {
          duplicateMatches: [{ memoryId: MEM_ID, score: 0.98 }],
        },
      });
      mockLtmService.create.mockResolvedValue(dupMem);

      const result = await service.remember({
        userId: USER_ID,
        content: 'TypeScript uses structural typing',
        type: 'long-term',
        tags: [],
        skipDuplicateCheck: false,
      });

      expect(result.wasDeduped).toBe(true);
    });

    it('routes to short-term when ttl is provided in auto mode', async () => {
      const stmMem = { ...makeMemory(), ttl: 3600 };
      mockStmService.create.mockResolvedValue(stmMem);

      const result = await service.remember({
        userId: USER_ID,
        content: 'Reminder: review PR',
        type: 'auto',
        ttl: 3600,
        tags: [],
        skipDuplicateCheck: false,
      });

      expect(result.resolvedType).toBe('short-term');
    });
  });

  // ─── forget ─────────────────────────────────────────────────────────────────

  describe('forget', () => {
    it('returns candidates without deleting in dry-run mode', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        {
          memory: makeMemory({
            id: 'clm2222222222222222222222',
            content: 'my laptop password',
          }),
          score: 0.9,
        },
        {
          memory: makeMemory({
            id: 'clm3333333333333333333333',
            content: 'laptop is Dell XPS',
          }),
          score: 0.75,
        },
      ]);

      const result = await service.forget({
        userId: USER_ID,
        query: 'laptop password',
        limit: 5,
        confirm: false,
        minScore: 0.7,
      });

      expect(result.dryRun).toBe(true);
      expect(result.deleted).toBe(0);
      expect(result.candidates).toHaveLength(2);
    });

    it('deletes candidates when confirm=true', async () => {
      const mem1 = makeMemory({
        id: 'clm2222222222222222222222',
        content: 'old password',
      });
      ltmService.semanticSearch.mockResolvedValue([
        { memory: mem1, score: 0.92 },
      ]);
      mockLtmService.delete.mockResolvedValue(true);
      // deleteMemory tries STM first, then LTM
      mockStmService.delete.mockRejectedValue(
        new StmMemoryNotFoundError('clm2222222222222222222222'),
      );

      const result = await service.forget({
        userId: USER_ID,
        query: 'old password',
        limit: 5,
        confirm: true,
        minScore: 0.7,
      });

      expect(result.dryRun).toBe(false);
      expect(result.deleted).toBe(1);
    });

    it('filters out candidates below minScore', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        { memory: makeMemory({ id: 'clm2222222222222222222222' }), score: 0.9 },
        { memory: makeMemory({ id: 'clm3333333333333333333333' }), score: 0.4 }, // below threshold
      ]);

      const result = await service.forget({
        userId: USER_ID,
        query: 'some concept',
        limit: 5,
        confirm: false,
        minScore: 0.6,
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.memoryId).toBe('clm2222222222222222222222');
    });
  });

  // ─── reflect ────────────────────────────────────────────────────────────────

  describe('reflect', () => {
    it('returns empty reflection when no memories found', async () => {
      ltmService.semanticSearch.mockResolvedValue([]);

      const result = await service.reflect({
        userId: USER_ID,
        query: 'quantum computing',
        limit: 10,
        minScore: 0.5,
      });

      expect(result.memoryCount).toBe(0);
      expect(result.sourceIds).toHaveLength(0);
      expect(result.dateRange).toBeNull();
    });

    it('returns summary with themes and source IDs', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        {
          memory: makeMemory({
            id: 'clm2222222222222222222222',
            content: 'Decided to use Postgres for persistence',
            tags: ['decision', 'database'],
            createdAt: new Date('2025-01-01'),
          }),
          score: 0.9,
        },
        {
          memory: makeMemory({
            id: 'clm3333333333333333333333',
            content: 'Postgres supports JSONB natively',
            tags: ['database', 'facts'],
            createdAt: new Date('2025-01-05'),
          }),
          score: 0.8,
        },
      ]);

      const result = await service.reflect({
        userId: USER_ID,
        query: 'database decisions',
        limit: 10,
        minScore: 0.5,
      });

      expect(result.memoryCount).toBe(2);
      expect(result.sourceIds).toEqual([
        'clm2222222222222222222222',
        'clm3333333333333333333333',
      ]);
      expect(result.themes).toContain('database');
      expect(result.dateRange).not.toBeNull();
      expect(result.summary).toContain('database decisions');
    });

    it('filters out hits below minScore', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        { memory: makeMemory({ id: 'clm2222222222222222222222' }), score: 0.8 },
        { memory: makeMemory({ id: 'clm3333333333333333333333' }), score: 0.3 }, // below threshold
      ]);

      const result = await service.reflect({
        userId: USER_ID,
        query: 'test',
        limit: 10,
        minScore: 0.5,
      });

      expect(result.memoryCount).toBe(1);
    });
  });

  // ─── compressContext ─────────────────────────────────────────────────────────

  describe('compressContext', () => {
    it('returns formatted context block', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        {
          memory: makeMemory({
            id: MEM_ID,
            content: 'Use Redis for caching',
            tags: ['infra'],
          }),
          score: 0.85,
        },
      ]);

      const result = await service.compressContext({
        userId: USER_ID,
        query: 'caching strategy',
        limit: 10,
        maxChars: 4000,
        minScore: 0.5,
      });

      expect(result.memoryCount).toBe(1);
      expect(result.context).toContain('Use Redis for caching');
      expect(result.charCount).toBeGreaterThan(0);
    });

    it('returns empty context block when no relevant memories', async () => {
      ltmService.semanticSearch.mockResolvedValue([]);

      const result = await service.compressContext({
        userId: USER_ID,
        query: 'obscure topic',
        limit: 10,
        maxChars: 4000,
        minScore: 0.8,
      });

      expect(result.memoryCount).toBe(0);
      expect(result.context).toBe('(no memories)');
    });

    it('truncates content when memories exceed maxChars', async () => {
      const longContent = 'x'.repeat(200);
      ltmService.semanticSearch.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          memory: makeMemory({ id: MEM_ID, content: longContent + String(i) }),
          score: 0.9,
        })),
      );

      const result = await service.compressContext({
        userId: USER_ID,
        query: 'anything',
        limit: 10,
        maxChars: 300,
        minScore: 0.5,
      });

      expect(result.truncated).toBe(true);
      expect(result.charCount).toBeLessThanOrEqual(400); // small buffer for headers
    });
  });

  // ─── loadContext ─────────────────────────────────────────────────────────────

  describe('loadContext', () => {
    it('blends recent and important memories deduped', async () => {
      const sharedId = 'clm2222222222222222222222';
      const shared = makeMemory({ id: sharedId });
      const recent = makeMemory({
        id: 'clm3333333333333333333333',
        createdAt: new Date('2025-06-01'),
      });
      // list is called twice; first returns recent, second returns a broader set including shared
      mockLtmService.list
        .mockResolvedValueOnce({ items: [recent, shared] })
        .mockResolvedValueOnce({
          items: [shared, makeMemory({ id: 'clm4444444444444444444444' })],
        });

      const result = await service.loadContext({
        userId: USER_ID,
        maxChars: 6000,
        recentLimit: 2,
        importantLimit: 2,
      });

      // shared memory should appear only once
      const mentionCount = (
        result.context.match(new RegExp(sharedId, 'g')) ?? []
      ).length;
      expect(mentionCount).toBeLessThanOrEqual(1);
      expect(result.memoryCount).toBeGreaterThan(0);
    });

    it('returns context block with no memories gracefully', async () => {
      mockLtmService.list.mockResolvedValue({ items: [] });

      const result = await service.loadContext({
        userId: USER_ID,
        maxChars: 6000,
        recentLimit: 5,
        importantLimit: 10,
      });

      expect(result.memoryCount).toBe(0);
      expect(result.context).toBe('(no memories)');
    });
  });

  // ─── assemblePromptContext ───────────────────────────────────────────────────

  describe('assemblePromptContext', () => {
    it('returns formatted context block within token budget', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        {
          memory: makeMemory({
            id: MEM_ID,
            content: 'Use Redis for caching',
            tags: ['infra'],
          }),
          score: 0.85,
        },
      ]);

      const result = await service.assemblePromptContext({
        userId: USER_ID,
        query: 'caching strategy',
        tokenBudget: 2000,
        limit: 20,
        minScore: 0.5,
      });

      expect(result.memoryCount).toBe(1);
      expect(result.context).toContain('Use Redis for caching');
      expect(result.estimatedTokens).toBeGreaterThan(0);
      expect(result.estimatedTokens).toBeLessThanOrEqual(result.tokenBudget);
      expect(result.tokenBudget).toBe(2000);
      expect(result.truncated).toBe(false);
    });

    it('returns empty context block when no memories pass minScore', async () => {
      ltmService.semanticSearch.mockResolvedValue([
        { memory: makeMemory({ id: MEM_ID }), score: 0.3 },
      ]);

      const result = await service.assemblePromptContext({
        userId: USER_ID,
        query: 'obscure topic',
        tokenBudget: 2000,
        limit: 20,
        minScore: 0.5,
      });

      expect(result.memoryCount).toBe(0);
      expect(result.context).toBe('(no memories)');
      expect(result.truncated).toBe(false);
    });

    it('truncates when memories exceed the token budget', async () => {
      const longContent = 'x'.repeat(400); // ~100 tokens per entry
      ltmService.semanticSearch.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          memory: makeMemory({ id: MEM_ID, content: longContent + String(i) }),
          score: 0.9,
        })),
      );

      const result = await service.assemblePromptContext({
        userId: USER_ID,
        query: 'anything',
        tokenBudget: 200,
        limit: 10,
        minScore: 0.5,
      });

      expect(result.truncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(result.tokenBudget);
      expect(result.memoryCount).toBeGreaterThan(0);
    });

    it('enforces budget even for a single oversized memory', async () => {
      const hugContent = 'y'.repeat(20000); // ~5000 tokens
      ltmService.semanticSearch.mockResolvedValue([
        { memory: makeMemory({ id: MEM_ID, content: hugContent }), score: 0.9 },
      ]);

      const result = await service.assemblePromptContext({
        userId: USER_ID,
        query: 'big memory',
        tokenBudget: 300,
        limit: 5,
        minScore: 0.5,
      });

      expect(result.estimatedTokens).toBeLessThanOrEqual(result.tokenBudget);
      expect(result.truncated).toBe(true);
      expect(result.memoryCount).toBe(1);
    });

    it('passes scope through to semanticSearch', async () => {
      ltmService.semanticSearch.mockResolvedValue([]);

      await service.assemblePromptContext({
        userId: USER_ID,
        query: 'scoped query',
        tokenBudget: 500,
        limit: 10,
        minScore: 0.5,
        scope: 'project-x',
      });

      expect(ltmService.semanticSearch).toHaveBeenCalledWith(
        USER_ID,
        'scoped query',
        expect.objectContaining({ scope: 'project-x' }),
      );
    });

    it('echoes tokenBudget in result', async () => {
      ltmService.semanticSearch.mockResolvedValue([]);

      const result = await service.assemblePromptContext({
        userId: USER_ID,
        query: 'test',
        tokenBudget: 750,
        limit: 5,
        minScore: 0.5,
      });

      expect(result.tokenBudget).toBe(750);
    });
  });
});

// ─── C2: Bulk Ingestion ──────────────────────────────────────────────────────

describe('MemoryService — C2 Bulk Conversation Ingestion', () => {
  let service: MemoryService;

  const mockStmService = {
    create: jest.fn(),
    findById: jest.fn().mockRejectedValue(new Error('not found')),
    update: jest.fn(),
    delete: jest.fn(),
    list: jest.fn().mockResolvedValue({ items: [], totalCount: 0 }),
  };

  const mockLtmService = {
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
    promote: jest.fn(),
    semanticSearch: jest.fn(),
    reindex: jest.fn(),
  };

  const mockImportanceService = {
    score: jest.fn().mockReturnValue({
      score: 0.5,
      status: 'active',
      factors: {},
      reasons: [],
    }),
  };

  const USER_ID = 'clm0000000000000000000000';
  const MEM_ID = 'clm1111111111111111111111';

  const makeMemory = (overrides: Partial<LtmMemory> = {}): LtmMemory => ({
    id: MEM_ID,
    userId: USER_ID,
    content: 'Test memory content',
    metadata: {},
    tags: [],
    embedding: [],
    type: 'long-term',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    expiresAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: MemoryStmService, useValue: mockStmService },
        { provide: MemoryLtmService, useValue: mockLtmService },
        { provide: ImportanceScoringService, useValue: mockImportanceService },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
  });

  describe('ingestConversation', () => {
    it('ingests each turn as a separate long-term memory', async () => {
      const mem = makeMemory();
      mockLtmService.create.mockResolvedValue(mem);

      const result = await service.ingestConversation({
        userId: USER_ID,
        turns: [
          { role: 'user', content: 'Hello, what is TypeScript?' },
          {
            role: 'assistant',
            content: 'TypeScript is a typed superset of JavaScript.',
          },
        ],
        concurrency: 2,
        tags: ['ts'],
      });

      expect(result.ingested).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
      expect(result.memoryIds).toHaveLength(2);
      expect(mockLtmService.create).toHaveBeenCalledTimes(2);
    });

    it('counts skipped when LTM returns a deduplicated memory', async () => {
      const dupMem = makeMemory({
        metadata: { duplicateMatches: [{ memoryId: MEM_ID, score: 0.99 }] },
      });
      mockLtmService.create.mockResolvedValue(dupMem);

      const result = await service.ingestConversation({
        userId: USER_ID,
        turns: [
          {
            role: 'user',
            content: 'TypeScript is a typed superset of JavaScript.',
          },
        ],
        concurrency: 1,
        tags: [],
      });

      expect(result.skipped).toBe(1);
      expect(result.ingested).toBe(0);
      expect(result.memoryIds).toHaveLength(1);
    });

    it('counts failed without throwing when a turn errors', async () => {
      mockLtmService.create
        .mockResolvedValueOnce(makeMemory({ id: 'clm2222222222222222222222' }))
        .mockRejectedValueOnce(new Error('embedding timeout'));

      const result = await service.ingestConversation({
        userId: USER_ID,
        turns: [
          { role: 'user', content: 'First turn' },
          { role: 'assistant', content: 'Second turn' },
        ],
        concurrency: 1,
        tags: [],
      });

      expect(result.ingested).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.memoryIds).toHaveLength(2);
      expect(result.memoryIds[1]).toBe('');
    });

    it('is idempotent: re-ingesting the same conversation returns same count', async () => {
      const mem = makeMemory();
      mockLtmService.create.mockResolvedValue(mem);

      const turns = [{ role: 'user', content: 'What is Postgres?' }];
      const first = await service.ingestConversation({
        userId: USER_ID,
        turns,
        concurrency: 1,
        tags: [],
      });

      // Second call - LTM returns dedup annotation
      const dupMem = makeMemory({
        metadata: { duplicateMatches: [{ memoryId: MEM_ID, score: 1.0 }] },
      });
      mockLtmService.create.mockResolvedValue(dupMem);
      const second = await service.ingestConversation({
        userId: USER_ID,
        turns,
        concurrency: 1,
        tags: [],
      });

      expect(first.ingested + first.skipped).toBe(1);
      expect(second.ingested + second.skipped).toBe(1);
    });

    it('handles large payloads (100 turns) without error', async () => {
      const mem = makeMemory();
      mockLtmService.create.mockResolvedValue(mem);

      const turns = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message number ${i + 1} in a long conversation.`,
      }));

      const result = await service.ingestConversation({
        userId: USER_ID,
        turns,
        concurrency: 5,
        tags: [],
      });

      expect(result.total).toBe(100);
      expect(result.ingested + result.skipped + result.failed).toBe(100);
      expect(result.memoryIds).toHaveLength(100);
    });
  });

  // ─── splitTurnsToChunks (static helper) ─────────────────────────────────────

  describe('splitTurnsToChunks', () => {
    it('returns one chunk per short turn', () => {
      const chunks = MemoryService.splitTurnsToChunks([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]);
      expect(chunks).toEqual(['user: Hello', 'assistant: Hi there']);
    });

    it('splits a turn that exceeds the char limit', () => {
      const longContent = 'A'.repeat(6000) + '\n\n' + 'B'.repeat(6000);
      const chunks = MemoryService.splitTurnsToChunks(
        [{ role: 'user', content: longContent }],
        10240,
      );
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(10240);
      }
    });

    it('hard-cuts a single paragraph longer than the limit', () => {
      const veryLong = 'X'.repeat(25000);
      const chunks = MemoryService.splitTurnsToChunks(
        [{ role: 'user', content: veryLong }],
        10240,
      );
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(10240);
        expect(c.startsWith('user: ')).toBe(true);
      }
    });

    it('preserves all content across chunks (no data loss)', () => {
      const content = ['Para1', 'Para2', 'Para3'].join('\n\n');
      const chunks = MemoryService.splitTurnsToChunks(
        [{ role: 'user', content }],
        10240,
      );
      const combined = chunks.map((c) => c.replace(/^user: /, '')).join('\n\n');
      expect(combined).toContain('Para1');
      expect(combined).toContain('Para2');
      expect(combined).toContain('Para3');
    });
  });
});

// ─── Static Token Helpers ─────────────────────────────────────────────────────

const makeRawMemory = (overrides: Partial<Memory> = {}): Memory => ({
  id: 'clm1111111111111111111111',
  userId: 'clm0000000000000000000000',
  content: 'Test memory content',
  metadata: {},
  tags: [],
  embedding: [],
  type: 'long-term',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  expiresAt: null,
  ...overrides,
});

describe('MemoryService.estimateTokens (static)', () => {
  it('returns ceil(chars / 4) for a simple string', () => {
    expect(MemoryService.estimateTokens('abcd')).toBe(1); // 4/4 = 1
    expect(MemoryService.estimateTokens('abcde')).toBe(2); // ceil(5/4) = 2
    expect(MemoryService.estimateTokens('')).toBe(0);
    expect(MemoryService.estimateTokens('a'.repeat(100))).toBe(25);
  });

  it('always over-counts (conservative)', () => {
    // every string of length n → ceil(n/4) ≥ n/4
    for (const len of [1, 3, 5, 7, 99]) {
      const result = MemoryService.estimateTokens('a'.repeat(len));
      expect(result).toBeGreaterThanOrEqual(len / 4);
    }
  });
});

describe('MemoryService.buildTokenBudgetedBlock (static)', () => {
  it('returns (no memories) for empty input', () => {
    const result = MemoryService.buildTokenBudgetedBlock([], 1000);
    expect(result.context).toBe('(no memories)');
    expect(result.memoryCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.tokenBudget).toBe(1000);
  });

  it('includes all memories when they fit in the budget', () => {
    const memories = [
      makeRawMemory({ content: 'short content A' }),
      makeRawMemory({ content: 'short content B' }),
    ];
    const result = MemoryService.buildTokenBudgetedBlock(memories, 2000);
    expect(result.memoryCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.estimatedTokens).toBeLessThanOrEqual(2000);
  });

  it('respects token budget: estimatedTokens ≤ tokenBudget', () => {
    const bigContent = 'w'.repeat(10000);
    const memories = Array.from({ length: 5 }, () =>
      makeRawMemory({ content: bigContent }),
    );
    const budget = 300;
    const result = MemoryService.buildTokenBudgetedBlock(memories, budget);
    expect(result.estimatedTokens).toBeLessThanOrEqual(budget);
  });

  it('truncates a single memory larger than the budget', () => {
    const hugContent = 'z'.repeat(50000); // ~12500 tokens
    const result = MemoryService.buildTokenBudgetedBlock(
      [makeRawMemory({ content: hugContent })],
      200,
    );
    expect(result.estimatedTokens).toBeLessThanOrEqual(200);
    expect(result.truncated).toBe(true);
    expect(result.memoryCount).toBe(1);
  });

  it('marks truncated=true when not all memories fit', () => {
    const memories = Array.from({ length: 20 }, (_, i) =>
      makeRawMemory({ content: `Memory content number ${i} `.repeat(50) }),
    );
    const result = MemoryService.buildTokenBudgetedBlock(memories, 500);
    expect(result.truncated).toBe(true);
    expect(result.memoryCount).toBeLessThan(20);
    expect(result.estimatedTokens).toBeLessThanOrEqual(500);
  });

  it('includes tags in the formatted header', () => {
    const result = MemoryService.buildTokenBudgetedBlock(
      [makeRawMemory({ content: 'tagged content', tags: ['foo', 'bar'] })],
      2000,
    );
    expect(result.context).toContain('[foo, bar]');
  });

  it('echoes tokenBudget in result', () => {
    const result = MemoryService.buildTokenBudgetedBlock([], 777);
    expect(result.tokenBudget).toBe(777);
  });
});
