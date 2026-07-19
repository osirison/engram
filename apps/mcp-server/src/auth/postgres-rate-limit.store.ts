import { Injectable } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import type { RateLimitStore, RateLimitIncrementResult } from '@engram/auth';

/** Clamp increment units to a positive integer (defensive; the service already normalizes). */
function sanitizeUnits(units: number): number {
  return Number.isFinite(units) ? Math.max(1, Math.floor(units)) : 1;
}

/**
 * Postgres-backed fixed-window counter for the rate limiter (replacement for
 * the Redis Lua INCRBY + first-hit EXPIRE).
 *
 * The whole increment is one atomic upsert: the first hit of a window inserts
 * the row and anchors the window (`expiresAt`); later hits increment the
 * counter without touching the window; a hit after the window has lapsed
 * resets both — all inside the same statement, so concurrent requests across
 * processes serialize on the row exactly like Redis serialized on the key.
 */
@Injectable()
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly prisma: PrismaService) {}

  async increment(
    key: string,
    windowSeconds: number,
    units = 1,
  ): Promise<RateLimitIncrementResult> {
    const increment = sanitizeUnits(units);
    const rows = await this.prisma.$queryRaw<
      Array<{ count: number; ttlSeconds: number }>
    >`
      INSERT INTO "rate_limit_counters" ("key", "count", "expiresAt")
      VALUES (${key}, ${increment}, now() + make_interval(secs => ${windowSeconds}))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "rate_limit_counters"."expiresAt" <= now() THEN EXCLUDED."count"
          ELSE "rate_limit_counters"."count" + EXCLUDED."count"
        END,
        "expiresAt" = CASE
          WHEN "rate_limit_counters"."expiresAt" <= now() THEN EXCLUDED."expiresAt"
          ELSE "rate_limit_counters"."expiresAt"
        END
      RETURNING "count",
        CEIL(EXTRACT(EPOCH FROM ("expiresAt" - now())))::int AS "ttlSeconds"
    `;

    const row = rows[0];
    if (!row) {
      // RETURNING always yields a row for INSERT..ON CONFLICT DO UPDATE;
      // guard anyway so a driver quirk fails loudly rather than dividing by
      // undefined in the limiter.
      throw new Error(`Rate-limit upsert returned no row for key ${key}`);
    }
    return { count: Number(row.count), ttlSeconds: Number(row.ttlSeconds) };
  }

  /** Remove counters whose window has lapsed; returns the number deleted. */
  async sweepExpired(): Promise<number> {
    const result = await this.prisma.rateLimitCounter.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return result.count;
  }
}
