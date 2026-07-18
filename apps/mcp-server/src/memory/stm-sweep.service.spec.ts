import { SchedulerRegistry } from '@nestjs/schedule';
import { StmSweepService } from './stm-sweep.service';

describe('StmSweepService', () => {
  const envBackup = process.env.STM_SWEEP_INTERVAL_MS;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (envBackup === undefined) {
      delete process.env.STM_SWEEP_INTERVAL_MS;
    } else {
      process.env.STM_SWEEP_INTERVAL_MS = envBackup;
    }
  });

  it('runs sweepExpired on the configured interval', async () => {
    process.env.STM_SWEEP_INTERVAL_MS = '1000';
    const provider = { sweepExpired: jest.fn().mockResolvedValue(2) };
    const service = new StmSweepService(new SchedulerRegistry(), provider);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(2500);
    service.onModuleDestroy();

    expect(provider.sweepExpired).toHaveBeenCalledTimes(2);
  });

  it('does not schedule when the interval is 0', () => {
    process.env.STM_SWEEP_INTERVAL_MS = '0';
    const provider = { sweepExpired: jest.fn() };
    const registry = new SchedulerRegistry();
    const service = new StmSweepService(registry, provider);

    service.onModuleInit();

    expect(registry.doesExist('interval', 'stm_expiry_sweep')).toBe(false);
    service.onModuleDestroy();
  });

  it('does not schedule when the provider has no sweepExpired (in-process adapter)', () => {
    process.env.STM_SWEEP_INTERVAL_MS = '1000';
    const registry = new SchedulerRegistry();
    const service = new StmSweepService(registry, {});

    service.onModuleInit();

    expect(registry.doesExist('interval', 'stm_expiry_sweep')).toBe(false);
    service.onModuleDestroy();
  });

  it('run() returns 0 when no provider is wired', async () => {
    const service = new StmSweepService(new SchedulerRegistry(), undefined);

    await expect(service.run()).resolves.toBe(0);
  });

  it('survives a failing sweep and keeps the schedule', async () => {
    process.env.STM_SWEEP_INTERVAL_MS = '1000';
    const provider = {
      sweepExpired: jest
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(1),
    };
    const service = new StmSweepService(new SchedulerRegistry(), provider);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(2500);
    service.onModuleDestroy();

    expect(provider.sweepExpired).toHaveBeenCalledTimes(2);
  });
});
