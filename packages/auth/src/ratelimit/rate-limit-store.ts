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
   * Atomically increment the counter at `key` by `units` (a positive integer,
   * defaulting to 1). The window TTL must be applied on the first increment of
   * a window (when the counter transitions from absent to `units`) and left
   * untouched thereafter, giving a fixed window anchored at the first request.
   *
   * Multi-unit increments let the limiter meter by actual work: a request that
   * fans out into N downstream operations charges N units in one atomic step.
   */
  increment(key: string, windowSeconds: number, units?: number): Promise<RateLimitIncrementResult>;
}
