import { Injectable } from '@nestjs/common';
import { RedisService } from '@engram/redis';
import type { SessionStore } from '@engram/auth';

/** Minimal view of the underlying client for the atomic GETDEL command. */
interface GetDelCapable {
  getdel?: (key: string) => Promise<string | null>;
}

/**
 * Redis-backed {@link SessionStore} for interactive sessions and one-time OAuth
 * state. `getDelete` prefers the atomic `GETDEL` (Redis 6.2+) so a one-time
 * OAuth `state` cannot be replayed; it falls back to GET+DEL otherwise.
 */
@Injectable()
export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: RedisService) {}

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async getDelete(key: string): Promise<string | null> {
    const client = this.redis.getClient() as GetDelCapable;
    if (typeof client.getdel === 'function') {
      return client.getdel(key);
    }
    const value = await this.redis.get(key);
    if (value !== null) {
      await this.redis.del(key);
    }
    return value;
  }
}
