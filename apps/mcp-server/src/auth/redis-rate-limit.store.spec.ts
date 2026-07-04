import { RedisRateLimitStore } from './redis-rate-limit.store';
import type { RedisService } from '@engram/redis';

function makeRedis(
  over: Partial<Record<string, jest.Mock>> = {},
  client: { eval?: jest.Mock } = {},
): RedisService {
  return {
    incr: over.incr ?? jest.fn().mockResolvedValue(1),
    expire: over.expire ?? jest.fn().mockResolvedValue(true),
    ttl: over.ttl ?? jest.fn().mockResolvedValue(60),
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as RedisService;
}

describe('RedisRateLimitStore', () => {
  it('uses the atomic Lua eval path when available', async () => {
    const evalMock = jest.fn().mockResolvedValue([3, 42]);
    const redis = makeRedis({}, { eval: evalMock });
    const store = new RedisRateLimitStore(redis);

    const result = await store.increment('rl:user:1', 60);

    expect(result).toEqual({ count: 3, ttlSeconds: 42 });
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('INCRBY'),
      1,
      'rl:user:1',
      60,
      1,
    );
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('passes multi-unit increments through the Lua eval path', async () => {
    const evalMock = jest.fn().mockResolvedValue([7, 42]);
    const redis = makeRedis({}, { eval: evalMock });
    const store = new RedisRateLimitStore(redis);

    const result = await store.increment('rl:user:1', 60, 7);

    expect(result).toEqual({ count: 7, ttlSeconds: 42 });
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('INCRBY'),
      1,
      'rl:user:1',
      60,
      7,
    );
  });

  it('falls back to discrete commands when eval throws', async () => {
    const evalMock = jest.fn().mockRejectedValue(new Error('NOSCRIPT'));
    const redis = makeRedis(
      { incr: jest.fn().mockResolvedValue(1) },
      { eval: evalMock },
    );
    const store = new RedisRateLimitStore(redis);

    const result = await store.increment('rl:user:1', 60);

    expect(result).toEqual({ count: 1, ttlSeconds: 60 });
    expect(redis.expire).toHaveBeenCalledWith('rl:user:1', 60);
  });

  it('falls back when the client cannot eval', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(1) });
    const store = new RedisRateLimitStore(redis);

    expect(await store.increment('k', 30)).toEqual({
      count: 1,
      ttlSeconds: 30,
    });
  });

  it('increments by units in the fallback path and anchors the window on first hit', async () => {
    const incrMock = jest.fn().mockResolvedValue(5);
    const redis = makeRedis({ incr: incrMock });
    const store = new RedisRateLimitStore(redis);

    // Fresh window: counter equals the increment amount → TTL is applied.
    expect(await store.increment('k', 30, 5)).toEqual({
      count: 5,
      ttlSeconds: 30,
    });
    expect(incrMock).toHaveBeenCalledWith('k', 5);
    expect(redis.expire).toHaveBeenCalledWith('k', 30);
  });

  it('does not re-anchor the window on subsequent multi-unit hits', async () => {
    const redis = makeRedis({
      incr: jest.fn().mockResolvedValue(9), // 4 existing + 5 new ≠ 5 → not first hit
      ttl: jest.fn().mockResolvedValue(21),
    });
    const store = new RedisRateLimitStore(redis);

    expect(await store.increment('k', 60, 5)).toEqual({
      count: 9,
      ttlSeconds: 21,
    });
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('sanitizes non-positive units to a single unit', async () => {
    const evalMock = jest.fn().mockResolvedValue([1, 60]);
    const redis = makeRedis({}, { eval: evalMock });
    const store = new RedisRateLimitStore(redis);

    await store.increment('k', 60, 0);

    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('INCRBY'),
      1,
      'k',
      60,
      1,
    );
  });

  it('returns the existing TTL on subsequent hits within the window', async () => {
    const redis = makeRedis({
      incr: jest.fn().mockResolvedValue(5),
      ttl: jest.fn().mockResolvedValue(17),
    });
    const store = new RedisRateLimitStore(redis);

    expect(await store.increment('k', 60)).toEqual({
      count: 5,
      ttlSeconds: 17,
    });
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('re-anchors the window when an existing key has no expiry', async () => {
    const expireMock = jest.fn().mockResolvedValue(true);
    const redis = makeRedis({
      incr: jest.fn().mockResolvedValue(5),
      ttl: jest.fn().mockResolvedValue(-1),
      expire: expireMock,
    });
    const store = new RedisRateLimitStore(redis);

    expect(await store.increment('k', 60)).toEqual({
      count: 5,
      ttlSeconds: 60,
    });
    expect(expireMock).toHaveBeenCalledWith('k', 60);
  });
});
