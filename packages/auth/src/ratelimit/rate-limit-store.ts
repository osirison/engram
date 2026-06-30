/**
 * Counter store backing the fixed-window rate limiter.
 *
 * The package defines the interface; the host application provides a Redis
 * implementation (atomic `INCR` + first-hit `EXPIRE`). Unit tests use an
 * in-memory fake driven by an injectable clock.
 */
export interface RateLimitIncrementResult {
  /** Counter value *after* this increment (1 on the first hit of a window). */
  count: number;
  /** Seconds remaining until the window — and therefore the counter — resets. */
  ttlSeconds: number;
}

export interface RateLimitStore {
  /**
   * Atomically increment the counter at `key`. The window TTL must be applied
   * on the first increment (when the counter becomes 1) and left untouched
   * thereafter, giving a fixed window anchored at the first request.
   */
  increment(key: string, windowSeconds: number): Promise<RateLimitIncrementResult>;
}
