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

// Atomically: increment the counter by the requested units; set the window TTL
// only on the first hit (counter equals the increment amount); return
// [count, ttl]. Keeping this in one round-trip avoids a window that can grow
// without ever expiring if the process dies between INCRBY and EXPIRE.
const INCR_SCRIPT = `
local count = redis.call('INCRBY', KEYS[1], ARGV[2])
if count == tonumber(ARGV[2]) then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

/** Clamp increment units to a positive integer (defensive; the service already normalizes). */
function sanitizeUnits(units: number): number {
  return Number.isFinite(units) ? Math.max(1, Math.floor(units)) : 1;
}

/**
 * Redis-backed fixed-window counter for {@link RateLimitService}. Uses a Lua
 * script for an atomic INCRBY + first-hit EXPIRE + TTL read; falls back to
 * discrete commands if the client cannot `eval`. Increments by `units` so the
 * limiter can charge work-proportional costs (e.g. one unit per ingested
 * chunk) in a single atomic step.
 */
@Injectable()
export class RedisRateLimitStore implements RateLimitStore {
  private readonly logger = new Logger(RedisRateLimitStore.name);

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    windowSeconds: number,
    units = 1,
  ): Promise<RateLimitIncrementResult> {
    const increment = sanitizeUnits(units);
    const client = this.redis.getClient() as EvalCapable;
    if (typeof client.eval === 'function') {
      try {
        const result = (await client.eval(
          INCR_SCRIPT,
          1,
          key,
          windowSeconds,
          increment,
        )) as [number, number];
        return { count: Number(result[0]), ttlSeconds: Number(result[1]) };
      } catch (error) {
        this.logger.warn(
          `Rate-limit eval failed; falling back to discrete commands: ${String(error)}`,
        );
      }
    }
    return this.incrementWithoutEval(key, windowSeconds, increment);
  }

  private async incrementWithoutEval(
    key: string,
    windowSeconds: number,
    units: number,
  ): Promise<RateLimitIncrementResult> {
    const count = await this.redis.incr(key, units);
    // First hit of a window: the counter equals this increment exactly.
    if (count === units) {
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
