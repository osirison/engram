import { Test, TestingModule } from '@nestjs/testing';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

describe('MemoryController', () => {
  let controller: MemoryController;
  let memoryService: MemoryService;

  const mockMemoryService = {
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [
        {
          provide: MemoryService,
          useValue: mockMemoryService,
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
      });

      const payload = JSON.parse(response.content[0].text);
      expect(payload.query).toBe('hello');
      expect(payload.count).toBe(1);
      expect(payload.results[0].score).toBe(0.92);
      expect(payload.results[0].memory.id).toBe('ltm-1');
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

      const payload = JSON.parse(response.content[0].text);
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

      const response = await controller.reindexMemories({});
      const payload = JSON.parse(response.content[0].text);
      expect(payload.scope).toBe('all-users');
    });

    it('should reject an invalid batch size', async () => {
      await expect(
        controller.reindexMemories({ batchSize: 99999 }),
      ).rejects.toThrow(/Failed to reindex memories/);
    });
  });
});
