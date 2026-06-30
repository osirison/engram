import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@engram/redis';
import type { RateLimitStore, RateLimitIncrementResult } from '@engram/auth';

/** Minimal view of the underlying client for the atomic Lua increment. */
interface EvalCapable {
  eval?: (
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ) => Promise<unknown>;
}

// Atomically: increment the counter; set the window TTL only on the first hit;
// return [count, ttl]. Keeping this in one round-trip avoids a window that can
// grow without ever expiring if the process dies between INCR and EXPIRE.
const INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

/**
 * Redis-backed fixed-window counter for {@link RateLimitService}. Uses a Lua
 * script for an atomic INCR + first-hit EXPIRE + TTL read; falls back to
 * discrete commands if the client cannot `eval`.
 */
@Injectable()
export class RedisRateLimitStore implements RateLimitStore {
  private readonly logger = new Logger(RedisRateLimitStore.name);

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    windowSeconds: number,
  ): Promise<RateLimitIncrementResult> {
    const client = this.redis.getClient() as EvalCapable;
    if (typeof client.eval === 'function') {
      try {
        const result = (await client.eval(
          INCR_SCRIPT,
          1,
          key,
          windowSeconds,
        )) as [number, number];
        return { count: Number(result[0]), ttlSeconds: Number(result[1]) };
      } catch (error) {
        this.logger.warn(
          `Rate-limit eval failed; falling back to discrete commands: ${String(error)}`,
        );
      }
    }
    return this.incrementWithoutEval(key, windowSeconds);
  }

  private async incrementWithoutEval(
    key: string,
    windowSeconds: number,
  ): Promise<RateLimitIncrementResult> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
      return { count, ttlSeconds: windowSeconds };
    }
    let ttl = await this.redis.ttl(key);
    if (ttl < 0) {
      // The key exists without an expiry (a prior EXPIRE was lost, e.g. the
      // process died between INCR and EXPIRE). Re-anchor the window so the
      // counter cannot wedge permanently and block the identity forever.
      await this.redis.expire(key, windowSeconds);
      ttl = windowSeconds;
    }
    return { count, ttlSeconds: ttl };
  }
}
