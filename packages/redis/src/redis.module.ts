import { Module, Logger, type DynamicModule } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from './redis.service.js';

/**
 * Token under which the active Redis client is published. The default
 * `ioredis` client is used for profile-enterprise / profile-lite; a
 * process-local Map-based stub is used for profile-memory so the
 * dependency graph still wires a stable injection target.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('RedisModule');

function resolveDeploymentProfile(): 'memory' | 'lite' | 'enterprise' {
  const raw = process.env['DEPLOYMENT_PROFILE'];
  if (raw === undefined || raw === null || raw === '') {
    return 'enterprise';
  }
  const value = String(raw).toLowerCase();
  if (value === 'memory' || value === 'lite' || value === 'enterprise') {
    return value;
  }
  return 'enterprise';
}

interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  setex(key: string, ttl: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, ttl: number): Promise<number>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  incrby(key: string, value: number): Promise<number>;
  ping(): Promise<string>;
  scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]>;
  pipeline(): unknown;
  status: string;
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

/**
 * Build a no-op `ioredis`-shaped client backed by an in-process Map.
 *
 * Used only for profile-memory where Redis is intentionally absent.
 * The shape is intentionally close to ioredis so the
 * {@link RedisService} can keep its dependency on a single
 * `RedisLikeClient` and remain unaware of which backend is in use.
 */
function buildInMemoryRedisStub(): RedisLikeClient {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const isExpired = (entry: { expiresAt: number | null }): boolean =>
    entry.expiresAt !== null && entry.expiresAt <= Date.now();

  const purge = (key: string): void => {
    const entry = store.get(key);
    if (entry && isExpired(entry)) {
      store.delete(key);
    }
  };

  return {
    status: 'ready',
    async get(key: string): Promise<string | null> {
      purge(key);
      const entry = store.get(key);
      return entry ? entry.value : null;
    },
    async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
      // Support `EX <seconds>` argument form like ioredis.
      const ttlIndex = args.findIndex((a) => typeof a === 'string' && a.toUpperCase() === 'EX');
      const ttlSeconds =
        ttlIndex >= 0 && typeof args[ttlIndex + 1] === 'number'
          ? (args[ttlIndex + 1] as number)
          : null;
      store.set(key, {
        value,
        expiresAt: ttlSeconds !== null ? Date.now() + ttlSeconds * 1000 : null,
      });
      return 'OK';
    },
    async setex(key: string, ttl: number, value: string): Promise<unknown> {
      store.set(key, {
        value,
        expiresAt: Date.now() + ttl * 1000,
      });
      return 'OK';
    },
    async del(...keys: string[]): Promise<number> {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count += 1;
      }
      return count;
    },
    async exists(...keys: string[]): Promise<number> {
      let count = 0;
      for (const key of keys) {
        purge(key);
        if (store.has(key)) count += 1;
      }
      return count;
    },
    async expire(key: string, ttl: number): Promise<number> {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ttl * 1000;
      return 1;
    },
    async ttl(key: string): Promise<number> {
      purge(key);
      const entry = store.get(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    },
    async incr(key: string): Promise<number> {
      purge(key);
      const entry = store.get(key);
      const current = entry ? Number(entry.value) : 0;
      const next = current + 1;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async incrby(key: string, value: number): Promise<number> {
      purge(key);
      const entry = store.get(key);
      const current = entry ? Number(entry.value) : 0;
      const next = current + value;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async ping(): Promise<string> {
      return 'PONG';
    },
    async scan(_cursor: string, ..._args: unknown[]): Promise<[string, string[]]> {
      // Simplified: ignore the cursor and pattern; iterate the full
      // map and emit all non-expired keys in one batch. The returned
      // cursor is always '0' so callers stop after the first page.
      const keys: string[] = [];
      for (const [key, entry] of store.entries()) {
        if (!isExpired(entry)) {
          keys.push(key);
        } else {
          store.delete(key);
        }
      }
      return ['0', keys];
    },
    pipeline(): unknown {
      // The RedisService's pipeline usage is in scope; callers
      // (memory-stm) gate Redis access behind profile checks in
      // practice, so the no-op pipeline is safe. Tests cover this
      // branch.
      const stub = {
        get: (): unknown => stub,
        exec: async (): Promise<Array<[Error | null, unknown]>> => [],
      };
      return stub;
    },
    async connect(): Promise<RedisLikeClient> {
      return this;
    },
    async disconnect(): Promise<void> {
      // Nothing to disconnect.
    },
  };
}

/**
 * Profile-aware Redis module.
 *
 * The factory honors `DEPLOYMENT_PROFILE`:
 *  - profile=memory: register an in-process Map-backed client behind
 *    the `REDIS_CLIENT` token so consumers can inject `RedisService`
 *    without an external service. The stub is shaped like an
 *    `ioredis` client so `RedisService` does not need to know which
 *    backend is active.
 *  - profile=lite / enterprise: build the production ioredis client
 *    and expose it under the same token. Connection settings are
 *    unchanged from the previous module.
 */
@Module({})
export class RedisModule {
  static forRoot(): DynamicModule {
    const profile = resolveDeploymentProfile();
    const useStub = profile === 'memory';

    if (useStub) {
      logger.log('Profile=memory: wiring in-process Redis stub (no external Redis required)');
    }

    return {
      module: RedisModule,
      providers: [
        {
          provide: REDIS_CLIENT,
          useFactory: (): RedisLikeClient => {
            if (useStub) {
              return buildInMemoryRedisStub();
            }
            const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';
            return new Redis(redisUrl, {
              retryStrategy: (times) => Math.min(times * 50, 2000),
              maxRetriesPerRequest: 3,
              lazyConnect: false,
              enableOfflineQueue: true,
              connectTimeout: 10000,
              commandTimeout: 5000,
              enableReadyCheck: true,
              reconnectOnError: (err) => err.message.includes('READONLY'),
            }) as unknown as RedisLikeClient;
          },
        },
        RedisService,
      ],
      exports: [REDIS_CLIENT, RedisService],
    };
  }
}
