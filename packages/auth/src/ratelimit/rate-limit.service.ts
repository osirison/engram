import type { RateLimitStore } from './rate-limit-store.js';

/** A single rate-limit rule: at most `limit` requests per `windowSeconds`. */
export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitOptions {
  /** Applied to every request that has no matching per-tool override. */
  defaultRule: RateLimitRule;
  /**
   * Optional stricter rules for specific MCP tools (e.g. `reindex_memories`).
   * A request to an overridden tool is metered against its *own* counter and
   * rule, separate from the default identity bucket.
   */
  toolOverrides?: Record<string, RateLimitRule>;
}

export interface ConsumeParams {
  /** Stable identity for the caller: api-key id, user id, or client IP. */
  key: string;
  /** MCP tool being invoked, when known (enables per-tool overrides). */
  tool?: string;
  /**
   * Work units this request represents (default 1). Tool calls that fan out
   * into many downstream operations (e.g. `ingest_conversation` storing N
   * chunks, each an embedding + vector search + DB write) charge one unit per
   * operation, so a single metered request cannot amplify into unmetered
   * work. Non-finite or sub-1 values are normalized to 1.
   */
  units?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window (never negative). */
  remaining: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
}

const KEY_PREFIX = 'ratelimit:';

/**
 * Fixed-window rate limiter. The window is anchored at the first request in
 * each window (the store applies the TTL on the first increment), so a key that
 * goes quiet naturally resets when its TTL elapses.
 */
export class RateLimitService {
  private readonly defaultRule: RateLimitRule;
  private readonly toolOverrides: Record<string, RateLimitRule>;

  constructor(
    private readonly store: RateLimitStore,
    options: RateLimitOptions
  ) {
    this.defaultRule = options.defaultRule;
    this.toolOverrides = options.toolOverrides ?? {};
  }

  async consume(params: ConsumeParams): Promise<RateLimitResult> {
    const override = params.tool != null ? this.toolOverrides[params.tool] : undefined;
    const rule = override ?? this.defaultRule;
    const units = RateLimitService.normalizeUnits(params.units);

    // Overridden tools get a dedicated counter so their stricter budget is
    // tracked separately from the caller's general request budget.
    const redisKey = override
      ? `${KEY_PREFIX}${params.key}:tool:${params.tool}`
      : `${KEY_PREFIX}${params.key}`;

    const { count, ttlSeconds } = await this.store.increment(redisKey, rule.windowSeconds, units);

    const allowed = count <= rule.limit;
    const remaining = Math.max(0, rule.limit - count);
    // Guard against a missing TTL (e.g. key with no expiry): fall back to the
    // full window so Retry-After is never negative or zero-on-block.
    const resetSeconds = ttlSeconds > 0 ? ttlSeconds : rule.windowSeconds;

    return {
      allowed,
      limit: rule.limit,
      remaining,
      resetSeconds,
      retryAfterSeconds: allowed ? 0 : resetSeconds,
    };
  }

  /** Clamp `units` to a positive integer; anything unusable charges 1. */
  private static normalizeUnits(units: number | undefined): number {
    if (units == null || !Number.isFinite(units)) return 1;
    return Math.max(1, Math.floor(units));
  }
}
