import { AuthStoreSweepService } from './auth-store-sweep.service';
import type { PostgresSessionStore } from './postgres-session.store';
import type { PostgresRateLimitStore } from './postgres-rate-limit.store';

describe('AuthStoreSweepService', () => {
  const envBackup = process.env.AUTH_STORE_SWEEP_INTERVAL_MS;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (envBackup === undefined) {
      delete process.env.AUTH_STORE_SWEEP_INTERVAL_MS;
    } else {
      process.env.AUTH_STORE_SWEEP_INTERVAL_MS = envBackup;
    }
  });

  const makeStores = (): {
    session: jest.Mocked<Pick<PostgresSessionStore, 'sweepExpired'>>;
    rateLimit: jest.Mocked<Pick<PostgresRateLimitStore, 'sweepExpired'>>;
  } => ({
    session: { sweepExpired: jest.fn().mockResolvedValue(2) },
    rateLimit: { sweepExpired: jest.fn().mockResolvedValue(1) },
  });

  it('sweeps both stores on the configured interval', async () => {
    process.env.AUTH_STORE_SWEEP_INTERVAL_MS = '1000';
    const { session, rateLimit } = makeStores();
    const service = new AuthStoreSweepService(
      session as never,
      rateLimit as never,
    );

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(2500);
    service.onModuleDestroy();

    expect(session.sweepExpired).toHaveBeenCalledTimes(2);
    expect(rateLimit.sweepExpired).toHaveBeenCalledTimes(2);
  });

  it('run() sums deletions across stores', async () => {
    const { session, rateLimit } = makeStores();
    const service = new AuthStoreSweepService(
      session as never,
      rateLimit as never,
    );

    await expect(service.run()).resolves.toBe(3);
  });

  it('does not schedule when disabled via env', () => {
    process.env.AUTH_STORE_SWEEP_INTERVAL_MS = '0';
    const { session, rateLimit } = makeStores();
    const service = new AuthStoreSweepService(
      session as never,
      rateLimit as never,
    );

    service.onModuleInit();
    jest.advanceTimersByTime(10_000);
    service.onModuleDestroy();

    expect(session.sweepExpired).not.toHaveBeenCalled();
  });

  it('tolerates missing stores', async () => {
    const service = new AuthStoreSweepService(undefined, undefined);

    service.onModuleInit();
    await expect(service.run()).resolves.toBe(0);
    service.onModuleDestroy();
  });

  it('survives a failing sweep and keeps the schedule', async () => {
    process.env.AUTH_STORE_SWEEP_INTERVAL_MS = '1000';
    const session = {
      sweepExpired: jest
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(1),
    };
    const service = new AuthStoreSweepService(session as never, undefined);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(2500);
    service.onModuleDestroy();

    expect(session.sweepExpired).toHaveBeenCalledTimes(2);
  });
});
