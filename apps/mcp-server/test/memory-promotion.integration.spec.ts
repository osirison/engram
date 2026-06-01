import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { MemoryService } from '../src/memory/memory.service';
import { MemoryStmService, StmMemoryNotFoundError } from '@engram/memory-stm';
import {
  MemoryLtmService,
  LtmMemory,
  LtmMemoryNotFoundError,
} from '@engram/memory-ltm';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const TEST_USER_ID = 'promo-test-user-01';
const STM_ID = 'stm-promo-001';
const PROMOTED_LTM_ID = 'ltm-promoted-001';

const makePromotedLtm = (overrides: Partial<LtmMemory> = {}): LtmMemory => ({
  id: PROMOTED_LTM_ID,
  userId: TEST_USER_ID,
  content: 'Promoted memory content',
  metadata: { source: 'promotion' },
  tags: ['important', 'promoted'],
  embedding: [],
  type: 'long-term',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('MemoryService Promotion Integration', () => {
  let service: MemoryService;
  let stmService: jest.Mocked<MemoryStmService>;
  let ltmService: jest.Mocked<MemoryLtmService>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  beforeEach(async () => {
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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: MemoryStmService, useValue: stmMock },
        { provide: MemoryLtmService, useValue: ltmMock },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    stmService = module.get(MemoryStmService);
    ltmService = module.get(MemoryLtmService);
  });

  // -------------------------------------------------------------------------
  // Core promotion behaviour
  // -------------------------------------------------------------------------
  describe('STM → LTM promotion', () => {
    it('should delegate promotion to LTM service', async () => {
      const promoted = makePromotedLtm();
      ltmService.promote.mockResolvedValue(promoted);

      const result = await service.promoteMemory(TEST_USER_ID, STM_ID);

      expect(result).toEqual(promoted);
      expect(ltmService.promote).toHaveBeenCalledWith(TEST_USER_ID, STM_ID);
      expect(ltmService.promote).toHaveBeenCalledTimes(1);
    });

    it('should return promoted memory with long-term type and no expiry', async () => {
      const promoted = makePromotedLtm({
        content: 'Important context',
        tags: ['important', 'work'],
      });
      ltmService.promote.mockResolvedValue(promoted);

      const result = await service.promoteMemory(TEST_USER_ID, STM_ID);

      expect(result.type).toBe('long-term');
      expect(result.expiresAt).toBeNull();
      expect(result.content).toBe('Important context');
      expect(result.tags).toContain('important');
    });

    it('should preserve metadata from the original STM memory', async () => {
      const promoted = makePromotedLtm({
        metadata: { key: 'value', nested: { deep: true } },
      });
      ltmService.promote.mockResolvedValue(promoted);

      const result = await service.promoteMemory(TEST_USER_ID, STM_ID);

      expect(result.metadata).toEqual({ key: 'value', nested: { deep: true } });
    });

    it('should not interact with the STM service during promotion', async () => {
      ltmService.promote.mockResolvedValue(makePromotedLtm());

      await service.promoteMemory(TEST_USER_ID, STM_ID);

      expect(stmService.create).not.toHaveBeenCalled();
      expect(stmService.findById).not.toHaveBeenCalled();
      expect(stmService.update).not.toHaveBeenCalled();
      expect(stmService.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling during promotion
  // -------------------------------------------------------------------------
  describe('promotion error handling', () => {
    it('should propagate LtmMemoryNotFoundError when STM memory does not exist', async () => {
      ltmService.promote.mockRejectedValue(new LtmMemoryNotFoundError(STM_ID));

      await expect(service.promoteMemory(TEST_USER_ID, STM_ID)).rejects.toThrow(
        LtmMemoryNotFoundError,
      );
    });

    it('should propagate LtmMemoryNotFoundError when STM memory not found', async () => {
      ltmService.promote.mockRejectedValue(new StmMemoryNotFoundError(STM_ID));

      await expect(service.promoteMemory(TEST_USER_ID, STM_ID)).rejects.toThrow(
        StmMemoryNotFoundError,
      );
    });

    it('should propagate unexpected LTM service errors', async () => {
      ltmService.promote.mockRejectedValue(
        new Error('Database connection error'),
      );

      await expect(service.promoteMemory(TEST_USER_ID, STM_ID)).rejects.toThrow(
        'Database connection error',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Post-promotion retrieval
  // -------------------------------------------------------------------------
  describe('post-promotion retrieval', () => {
    it('should retrieve promoted memory via LTM fallback after promotion', async () => {
      const promoted = makePromotedLtm();
      ltmService.promote.mockResolvedValue(promoted);

      const promotedResult = await service.promoteMemory(TEST_USER_ID, STM_ID);

      // After promotion, the memory is in LTM and retrievable via fallback
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError(promotedResult.id),
      );
      ltmService.get.mockResolvedValue(promoted);

      const retrieved = await service.getMemory(
        TEST_USER_ID,
        promotedResult.id,
      );

      expect(retrieved).toEqual(promoted);
      expect(retrieved?.type).toBe('long-term');
      expect(retrieved?.expiresAt).toBeNull();
    });

    it('should not find promoted memory in STM after promotion', async () => {
      const promoted = makePromotedLtm();
      ltmService.promote.mockResolvedValue(promoted);

      const promotedResult = await service.promoteMemory(TEST_USER_ID, STM_ID);

      // Simulate that the promoted memory no longer exists in STM
      stmService.findById.mockRejectedValue(
        new StmMemoryNotFoundError(promotedResult.id),
      );
      ltmService.get.mockResolvedValue(promoted);

      await service.getMemory(TEST_USER_ID, promotedResult.id);

      // STM was checked but fell through to LTM
      expect(stmService.findById).toHaveBeenCalledWith(
        TEST_USER_ID,
        promotedResult.id,
      );
      expect(ltmService.get).toHaveBeenCalledWith(
        TEST_USER_ID,
        promotedResult.id,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent promotions
  // -------------------------------------------------------------------------
  describe('concurrent promotions', () => {
    it('should handle multiple concurrent promotion requests independently', async () => {
      const ids = ['stm-a', 'stm-b', 'stm-c'];
      ltmService.promote.mockImplementation((_userId, memoryId) =>
        Promise.resolve(makePromotedLtm({ id: `ltm-${memoryId}` })),
      );

      const results = await Promise.all(
        ids.map((id) => service.promoteMemory(TEST_USER_ID, id)),
      );

      expect(results).toHaveLength(3);
      expect(ltmService.promote).toHaveBeenCalledTimes(3);
      results.forEach((result, index) => {
        expect(result.id).toBe(`ltm-${ids[index]}`);
      });
    });
  });
});
