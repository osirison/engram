import { Injectable } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import type { SessionStore } from '@engram/auth';

/**
 * Postgres-backed {@link SessionStore} for interactive sessions, one-time
 * OAuth state, and the JWT jti denylist (via JwtRevocationService).
 *
 * Rows live in `auth_kv_entries` with an explicit expiry; reads filter on it,
 * and `getDelete` is a single `DELETE .. RETURNING` so a one-time OAuth
 * `state` cannot be replayed even across concurrent callbacks — the same
 * guarantee the Redis `GETDEL` gave. Expired rows are bulk-removed by
 * {@link AuthStoreSweepService}.
 */
@Injectable()
export class PostgresSessionStore implements SessionStore {
  constructor(private readonly prisma: PrismaService) {}

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.prisma.authKvEntry.upsert({
      where: { key },
      create: { key, value, expiresAt },
      update: { value, expiresAt },
    });
  }

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.authKvEntry.findUnique({ where: { key } });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return row.value;
  }

  async delete(key: string): Promise<void> {
    await this.prisma.authKvEntry.deleteMany({ where: { key } });
  }

  async getDelete(key: string): Promise<string | null> {
    // Atomic read-and-delete: only one concurrent caller can observe the
    // value. The expiry predicate keeps an expired-but-unswept row from
    // resurrecting a dead session or OAuth state.
    const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
      DELETE FROM "auth_kv_entries"
      WHERE "key" = ${key} AND "expiresAt" > now()
      RETURNING "value"
    `;
    return rows[0]?.value ?? null;
  }

  /** Remove expired rows; returns the number deleted. */
  async sweepExpired(): Promise<number> {
    const result = await this.prisma.authKvEntry.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return result.count;
  }
}
