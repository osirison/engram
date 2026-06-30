import { RedisSessionStore } from './redis-session.store';
import type { RedisService } from '@engram/redis';

function makeRedis(over: Partial<Record<string, jest.Mock>> = {}): {
  redis: RedisService;
  client: { getdel?: jest.Mock };
} {
  const client: { getdel?: jest.Mock } = {};
  const redis = {
    set: over.set ?? jest.fn().mockResolvedValue(undefined),
    get: over.get ?? jest.fn().mockResolvedValue(null),
    del: over.del ?? jest.fn().mockResolvedValue(1),
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as RedisService;
  return { redis, client };
}

describe('RedisSessionStore', () => {
  it('set/get/delete delegate to RedisService', async () => {
    const { redis } = makeRedis({
      get: jest.fn().mockResolvedValue('value'),
    });
    const store = new RedisSessionStore(redis);

    await store.set('k', 'v', 30);
    expect(redis.set).toHaveBeenCalledWith('k', 'v', 30);
    expect(await store.get('k')).toBe('value');
    await store.delete('k');
    expect(redis.del).toHaveBeenCalledWith('k');
  });

  it('getDelete uses atomic GETDEL when the client supports it', async () => {
    const { redis, client } = makeRedis();
    client.getdel = jest.fn().mockResolvedValue('state-value');
    const store = new RedisSessionStore(redis);

    expect(await store.getDelete('state')).toBe('state-value');
    expect(client.getdel).toHaveBeenCalledWith('state');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('getDelete falls back to GET+DEL when value is present', async () => {
    const { redis } = makeRedis({
      get: jest.fn().mockResolvedValue('state-value'),
    });
    const store = new RedisSessionStore(redis);

    expect(await store.getDelete('state')).toBe('state-value');
    expect(redis.del).toHaveBeenCalledWith('state');
  });

  it('getDelete fallback does not DEL when the key is absent', async () => {
    const { redis } = makeRedis({
      get: jest.fn().mockResolvedValue(null),
    });
    const store = new RedisSessionStore(redis);

    expect(await store.getDelete('state')).toBeNull();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
