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
      expect.stringContaining('INCR'),
      1,
      'rl:user:1',
      60,
    );
    expect(redis.incr).not.toHaveBeenCalled();
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
