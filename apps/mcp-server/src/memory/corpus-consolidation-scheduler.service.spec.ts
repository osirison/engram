import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { CorpusConsolidationService } from '@engram/memory-ltm';
import { CorpusConsolidationSchedulerService } from './corpus-consolidation-scheduler.service';

/**
 * Scheduler wiring for corpus consolidation (G3-T2), mirroring the
 * DecayService spec — with one deliberate inversion: the interval DEFAULTS to
 * 0 = OFF (review gate). Enabling it is the operator's explicit opt-in, and a
 * scheduled pass then runs a REAL merge (`dryRun: false`).
 */
describe('CorpusConsolidationSchedulerService', () => {
  const run = jest.fn();

  const build = async (
    withService = true,
  ): Promise<CorpusConsolidationSchedulerService> => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CorpusConsolidationSchedulerService,
        ...(withService
          ? [{ provide: CorpusConsolidationService, useValue: { run } }]
          : []),
      ],
    }).compile();
    return module.get(CorpusConsolidationSchedulerService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MEMORY_CONSOLIDATION_INTERVAL_MS;
    run.mockResolvedValue({
      scanned: 1,
      clusters: 0,
      merged: 0,
      skippedConcurrentEdit: 0,
      cursor: null,
      dryRun: false,
      perCluster: [],
      perClusterTruncated: false,
    });
  });

  afterEach(() => {
    delete process.env.MEMORY_CONSOLIDATION_INTERVAL_MS;
  });

  it('is OFF by default: no timer registered when MEMORY_CONSOLIDATION_INTERVAL_MS is unset', async () => {
    const service = await build();
    service.onModuleInit();

    // No timer was registered, so destroy must be a no-op.
    expect(() => service.onModuleDestroy()).not.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('stays off at an explicit MEMORY_CONSOLIDATION_INTERVAL_MS=0', async () => {
    process.env.MEMORY_CONSOLIDATION_INTERVAL_MS = '0';
    const service = await build();
    service.onModuleInit();

    expect(() => service.onModuleDestroy()).not.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('fires the consolidation pass at the configured interval (operator opt-in)', async () => {
    jest.useFakeTimers();
    try {
      process.env.MEMORY_CONSOLIDATION_INTERVAL_MS = '60000';
      const service = await build();
      service.onModuleInit();

      jest.advanceTimersByTime(60_000);
      expect(run).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(60_000);
      expect(run).toHaveBeenCalledTimes(2);

      service.onModuleDestroy();
      jest.advanceTimersByTime(120_000);
      expect(run).toHaveBeenCalledTimes(2); // cleaned up — no further ticks
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs a REAL merge pass (dryRun: false) — enabling the interval IS the review-gate opt-in', async () => {
    const service = await build();

    const result = await service.run();

    expect(run).toHaveBeenCalledWith({ dryRun: false });
    expect(result.dryRun).toBe(false);
  });

  it('returns an empty summary and skips when the consolidation service is absent', async () => {
    const service = await build(false);

    const result = await service.run();

    expect(result).toEqual({
      scanned: 0,
      clusters: 0,
      merged: 0,
      skippedConcurrentEdit: 0,
      cursor: null,
      dryRun: false,
      perCluster: [],
      perClusterTruncated: false,
    });
  });

  it('registers and cleans up the interval on init/destroy', async () => {
    process.env.MEMORY_CONSOLIDATION_INTERVAL_MS = '999999';
    const service = await build();

    service.onModuleInit();
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
