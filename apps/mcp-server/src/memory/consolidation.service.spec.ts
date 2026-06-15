import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { ConsolidationService } from './consolidation.service';
import { MemoryStmService } from '@engram/memory-stm';
import {
  MemoryLtmService,
  LtmMemoryQuotaExceededError,
  LtmPromotionError,
  ImportanceScoringService,
} from '@engram/memory-ltm';
import type { StmMemory } from '@engram/memory-stm';
import type { LtmMemory } from '@engram/memory-ltm';

const makeStmMemory = (overrides: Partial<StmMemory> = {}): StmMemory => ({
  id: 'clq0000000001abcdef0001',
  userId: 'cjld2cyuq0000t3rmniod1foy',
  content: 'test content',
  metadata: null,
  tags: [],
  embedding: [],
  type: 'short-term',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  expiresAt: new Date(Date.now() + 3600 * 1000),
  ttl: 3600,
  accessCount: 3,
  ...overrides,
});

const makeLtmMemory = (overrides: Partial<LtmMemory> = {}): LtmMemory => ({
  id: 'clq0000000001abcdef0001',
  userId: 'cjld2cyuq0000t3rmniod1foy',
  content: 'test content',
  metadata: null,
  tags: [],
  embedding: [],
  type: 'long-term',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  expiresAt: null,
  ...overrides,
});

describe('ConsolidationService', () => {
  let service: ConsolidationService;
  let stmService: jest.Mocked<MemoryStmService>;
  let ltmService: jest.Mocked<MemoryLtmService>;
  let importanceService: jest.Mocked<ImportanceScoringService>;

  beforeEach(async () => {
    delete process.env.STM_CONSOLIDATION_ACCESS_THRESHOLD;
    delete process.env.STM_CONSOLIDATION_INTERVAL_MS;

    const stmMock: Partial<jest.Mocked<MemoryStmService>> = {
      findCandidates: jest.fn(),
    };
    const ltmMock: Partial<jest.Mocked<MemoryLtmService>> = {
      promote: jest.fn(),
    };
    const importanceMock: Partial<jest.Mocked<ImportanceScoringService>> = {
      score: jest.fn().mockReturnValue({
        score: 0.8,
        status: 'active',
        factors: {
          base: 0.35,
          recencyMultiplier: 1,
          accessBoost: 0.1,
          cueBoost: 0.1,
          pinBoost: 0,
        },
        reasons: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        ConsolidationService,
        { provide: MemoryStmService, useValue: stmMock },
        { provide: MemoryLtmService, useValue: ltmMock },
        { provide: ImportanceScoringService, useValue: importanceMock },
      ],
    }).compile();

    service = module.get<ConsolidationService>(ConsolidationService);
    stmService = module.get(MemoryStmService);
    ltmService = module.get(MemoryLtmService);
    importanceService = module.get(ImportanceScoringService);
  });

  describe('run()', () => {
    it('should promote all qualifying candidates', async () => {
      const candidates = [
        makeStmMemory({ id: 'clq0000000001abcdef0001' }),
        makeStmMemory({ id: 'clq0000000002abcdef0002' }),
      ];
      stmService.findCandidates.mockResolvedValue(candidates);
      ltmService.promote.mockResolvedValue(makeLtmMemory());

      const result = await service.run();

      expect(result.promoted).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(ltmService.promote).toHaveBeenCalledTimes(2);
    });

    it('should count skipped when quota is exceeded', async () => {
      stmService.findCandidates.mockResolvedValue([makeStmMemory()]);
      ltmService.promote.mockRejectedValue(
        new LtmMemoryQuotaExceededError('cjld2cyuq0000t3rmniod1foy', 10000),
      );

      const result = await service.run();

      expect(result.promoted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should count skipped for Prisma unique constraint (already promoted)', async () => {
      stmService.findCandidates.mockResolvedValue([makeStmMemory()]);
      ltmService.promote.mockRejectedValue(
        new Error('Unique constraint failed on the fields: P2002'),
      );

      const result = await service.run();

      expect(result.promoted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should count failed for unexpected promotion errors', async () => {
      stmService.findCandidates.mockResolvedValue([makeStmMemory()]);
      ltmService.promote.mockRejectedValue(
        new Error('database connection lost'),
      );

      const result = await service.run();

      expect(result.promoted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should count skipped when LtmPromotionError wraps a P2002 unique constraint', async () => {
      // promote() wraps Prisma errors in LtmPromotionError; the P2002 signal
      // appears in the LtmPromotionError message.
      stmService.findCandidates.mockResolvedValue([makeStmMemory()]);
      ltmService.promote.mockRejectedValue(
        new LtmPromotionError(
          'clq0000000001abcdef0001',
          'Unique constraint failed on the fields: P2002',
        ),
      );

      const result = await service.run();

      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should count failed for LtmPromotionError without unique-constraint signal', async () => {
      stmService.findCandidates.mockResolvedValue([makeStmMemory()]);
      ltmService.promote.mockRejectedValue(
        new LtmPromotionError('clq0000000001abcdef0001', 'STM not found'),
      );

      const result = await service.run();

      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('should return early when STM service is unavailable', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [ScheduleModule.forRoot()],
        providers: [
          ConsolidationService,
          { provide: MemoryLtmService, useValue: ltmService },
          // No MemoryStmService provided
        ],
      }).compile();

      const serviceWithoutStm =
        module.get<ConsolidationService>(ConsolidationService);
      const result = await serviceWithoutStm.run();

      expect(result).toEqual({ promoted: 0, skipped: 0, failed: 0 });
    });

    it('should pass userId filter to findCandidates when provided', async () => {
      stmService.findCandidates.mockResolvedValue([]);
      await service.run('cjld2cyuq0000t3rmniod1foy');
      expect(stmService.findCandidates).toHaveBeenCalledWith(
        expect.any(Number),
        'cjld2cyuq0000t3rmniod1foy',
      );
    });

    it('should continue processing after a single failure', async () => {
      const candidates = [
        makeStmMemory({ id: 'clq0000000001abcdef0001' }),
        makeStmMemory({ id: 'clq0000000002abcdef0002' }),
        makeStmMemory({ id: 'clq0000000003abcdef0003' }),
      ];
      stmService.findCandidates.mockResolvedValue(candidates);
      ltmService.promote
        .mockResolvedValueOnce(makeLtmMemory())
        .mockRejectedValueOnce(new Error('transient error'))
        .mockResolvedValueOnce(makeLtmMemory());

      const result = await service.run();

      expect(result.promoted).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('should skip low-importance candidates', async () => {
      stmService.findCandidates.mockResolvedValue([makeStmMemory()]);
      importanceService.score.mockReturnValue({
        score: 0.2,
        status: 'stale',
        factors: {
          base: 0.35,
          recencyMultiplier: 0.4,
          accessBoost: 0,
          cueBoost: 0,
          pinBoost: 0,
        },
        reasons: ['stale'],
      });

      const result = await service.run();

      expect(result.skipped).toBe(1);
      expect(ltmService.promote).not.toHaveBeenCalled();
    });
  });
});
