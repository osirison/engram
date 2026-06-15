import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { MemoryLtmService } from '@engram/memory-ltm';
import { DecayService } from './decay.service';

describe('DecayService', () => {
  let service: DecayService;
  let ltmService: jest.Mocked<MemoryLtmService>;

  beforeEach(async () => {
    delete process.env.MEMORY_DECAY_INTERVAL_MS;
    const ltmMock: Partial<jest.Mocked<MemoryLtmService>> = {
      applyDecayPolicy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        DecayService,
        { provide: MemoryLtmService, useValue: ltmMock },
      ],
    }).compile();

    service = module.get(DecayService);
    ltmService = module.get(MemoryLtmService);
  });

  it('delegates decay runs to the LTM service with defaults', async () => {
    ltmService.applyDecayPolicy.mockResolvedValue({
      processed: 1,
      updated: 1,
      pruned: 0,
      stale: 0,
      cursor: null,
    });

    const result = await service.run();

    expect(result.processed).toBe(1);
    expect(ltmService.applyDecayPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        batchSize: 100,
        staleScoreThreshold: 0.3,
        pruneScoreThreshold: 0.15,
        pruneOlderThanDays: 30,
      }),
    );
  });

  it('returns empty result and skips LTM call when LTM service is absent', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [DecayService],
    }).compile();

    const serviceWithoutLtm = module.get(DecayService);
    const result = await serviceWithoutLtm.run();

    expect(result).toEqual({
      processed: 0,
      updated: 0,
      pruned: 0,
      stale: 0,
      cursor: null,
    });
  });

  it('skips registering a timer when MEMORY_DECAY_INTERVAL_MS=0', async () => {
    process.env.MEMORY_DECAY_INTERVAL_MS = '0';

    const module: TestingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        DecayService,
        { provide: MemoryLtmService, useValue: ltmService },
      ],
    }).compile();

    const svc = module.get(DecayService);
    svc.onModuleInit();

    // No timer was registered, so destroy should not throw.
    expect(() => svc.onModuleDestroy()).not.toThrow();

    delete process.env.MEMORY_DECAY_INTERVAL_MS;
  });

  it('registers and cleans up the interval on init/destroy', async () => {
    process.env.MEMORY_DECAY_INTERVAL_MS = '999999';
    ltmService.applyDecayPolicy.mockResolvedValue({
      processed: 0,
      updated: 0,
      pruned: 0,
      stale: 0,
      cursor: null,
    });

    const module: TestingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        DecayService,
        { provide: MemoryLtmService, useValue: ltmService },
      ],
    }).compile();

    const svc = module.get(DecayService);
    svc.onModuleInit();
    expect(() => svc.onModuleDestroy()).not.toThrow();

    delete process.env.MEMORY_DECAY_INTERVAL_MS;
  });
});
