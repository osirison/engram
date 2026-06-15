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
});
