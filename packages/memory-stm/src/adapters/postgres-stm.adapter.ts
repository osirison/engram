import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MemoryType, PrismaService } from '@engram/database';
import { EmbeddingsService } from '@engram/embeddings';
import {
  StmMemory,
  StmConfig,
  CreateStmMemoryData,
  UpdateStmMemoryData,
  ListStmOptionsData,
  PaginatedResult,
  StmMemoryNotFoundError,
  StmMemoryExpiredError,
  StmTtlValidationError,
  StmVersionConflictError,
  DEFAULT_STM_CONFIG,
  createStmMemorySchema,
  updateStmMemorySchema,
} from '../types';

/** Shape of the raw Prisma `memories` row this adapter reads/writes. */
interface StmRow {
  id: string;
  userId: string;
  organizationId: string | null;
  scope: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  tags: string[];
  type: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  embedding: number[];
}

/**
 * Postgres-backed short-term memory adapter.
 *
 * Stores STM records as rows in the shared `memories` table with
 * `type='short-term'` and `expiresAt` set — the schema has carried both
 * columns (plus `@@index([expiresAt])`) since the baseline migration, so no
 * migration is needed. This replaces the Redis-backed `MemoryStmService`:
 * STM survives restarts, and both tiers live in one queryable store.
 *
 * Semantics intentionally mirror the existing adapters:
 *  - UUID ids (parity with the Redis service; `memoryIdSchema` accepts them).
 *  - `accessCount` and the stored full-TTL window (`ttl`) live in the
 *    `metadata` JSON, the same convention `MemoryLtmService` uses for
 *    `accessCount`/`importance`.
 *  - Expiry is enforced by filtering on read (`expiresAt > now()`); expired
 *    rows are opportunistically deleted on touch and bulk-removed by
 *    `sweepExpired()` (scheduled by the mcp-server's StmSweepService).
 *  - `update()` preserves `expiresAt` unless a new `ttl` is explicitly
 *    provided (the WP2-T3/D4 preserve-by-default behavior).
 *  - `expectedVersion` updates are a true compare-and-set: the version guard
 *    is part of the UPDATE's WHERE clause, closing the read-compare-set race
 *    the Redis implementation documented as deferred.
 *  - Embeddings are generated best-effort and stored on the row; STM rows are
 *    NOT upserted into the vector index (parity with both prior adapters —
 *    promotion to LTM is what indexes a memory for semantic recall).
 */
@Injectable()
export class PostgresStmAdapter {
  private readonly logger = new Logger(PostgresStmAdapter.name);
  private readonly config: StmConfig;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly embeddingsService?: EmbeddingsService
  ) {
    this.config = { ...DEFAULT_STM_CONFIG };
  }

  /**
   * Create a new short-term memory.
   */
  async create(input: CreateStmMemoryData): Promise<StmMemory> {
    const validated = createStmMemorySchema.parse(input);
    const ttl = validated.ttl ?? this.config.defaultTtl;
    this.validateTtl(ttl);

    const memoryId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    // Embedding is best-effort: failures must not block memory creation.
    let embedding: number[] = [];
    if (this.embeddingsService) {
      const result = await this.embeddingsService
        .generate({ text: validated.content })
        .catch(() => null);
      embedding = result?.embedding ?? [];
    }

    const row = (await this.memoryDelegate().create({
      data: {
        id: memoryId,
        userId: validated.userId,
        organizationId: validated.organizationId ?? null,
        scope: validated.scope ?? null,
        content: validated.content,
        metadata: this.stampMetadata(validated.metadata ?? {}, 0, ttl),
        tags: validated.tags ?? [],
        type: MemoryType.SHORT_TERM,
        version: 1,
        expiresAt,
        embedding,
      },
    })) as StmRow;

    this.logger.debug(`STM memory created: ${memoryId}, expires at: ${expiresAt.toISOString()}`);
    return this.toStmMemory(row);
  }

  /**
   * Retrieve a short-term memory by ID. Bumps `accessCount` (best-effort) so
   * the consolidation policy can identify frequently-read memories.
   */
  async findById(
    userId: string,
    memoryId: string,
    organizationId?: string,
    scope?: string
  ): Promise<StmMemory> {
    const row = await this.fetchActive(userId, memoryId, organizationId);

    // Enforce scope isolation: treat a scope mismatch as not-found.
    if (scope !== undefined && (row.scope ?? undefined) !== scope) {
      throw new StmMemoryNotFoundError(memoryId);
    }

    const bumped = this.readAccessCount(row.metadata) + 1;
    const metadata = this.stampMetadata(row.metadata ?? {}, bumped, this.readTtl(row));

    // Best-effort persist: a failed counter write must not fail the read.
    // Under concurrent reads the count may be under-reported, which is
    // acceptable for a promotion heuristic (same trade-off as Redis).
    try {
      await this.memoryDelegate().updateMany({
        where: { id: memoryId, userId, type: MemoryType.SHORT_TERM },
        data: { metadata },
      });
    } catch {
      this.logger.warn(`Failed to persist accessCount bump for STM memory ${memoryId}`);
    }

    return this.toStmMemory({ ...row, metadata });
  }

  /**
   * Update a short-term memory. Preserves `expiresAt` unless `ttl` is
   * explicitly provided. When `expectedVersion` is set the write is a true
   * compare-and-set on the version column.
   */
  async update(
    userId: string,
    memoryId: string,
    input: UpdateStmMemoryData,
    organizationId?: string,
    scope?: string
  ): Promise<StmMemory> {
    const validated = updateStmMemorySchema.parse(input);
    const existing = await this.fetchActive(userId, memoryId, organizationId);

    if (scope !== undefined && (existing.scope ?? undefined) !== scope) {
      throw new StmMemoryNotFoundError(memoryId);
    }

    const existingVersion = existing.version ?? 1;
    if (validated.expectedVersion !== undefined && validated.expectedVersion !== existingVersion) {
      throw new StmVersionConflictError(memoryId, existingVersion);
    }

    const newTtl = validated.ttl ?? this.readTtl(existing);
    this.validateTtl(newTtl);
    const now = new Date();
    // Only reset expiresAt when the caller explicitly provides a new TTL
    // (WP2-T3/D4 preserve-by-default).
    const expiresAt =
      validated.ttl !== undefined ? new Date(now.getTime() + newTtl * 1000) : existing.expiresAt;

    const baseMetadata =
      validated.metadata !== undefined ? validated.metadata : (existing.metadata ?? {});
    const metadata = this.stampMetadata(
      baseMetadata ?? {},
      this.readAccessCount(existing.metadata),
      newTtl
    );

    const data = {
      content: validated.content ?? existing.content,
      tags: validated.tags ?? existing.tags,
      metadata,
      expiresAt,
    };

    const where = {
      id: memoryId,
      userId,
      organizationId: organizationId ?? null,
      type: MemoryType.SHORT_TERM,
    };

    if (validated.expectedVersion !== undefined) {
      // True CAS: the version guard rides in the WHERE clause, so a concurrent
      // writer that bumped the version makes this update match zero rows.
      const result = await this.memoryDelegate().updateMany({
        where: { ...where, version: existingVersion },
        data: { ...data, version: existingVersion + 1 },
      });
      if (result.count === 0) {
        const fresh = (await this.memoryDelegate().findFirst({ where })) as StmRow | null;
        throw new StmVersionConflictError(memoryId, fresh?.version ?? existingVersion);
      }
    } else {
      // Legacy last-write-wins path; version still bumps atomically.
      const result = await this.memoryDelegate().updateMany({
        where,
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new StmMemoryNotFoundError(memoryId);
      }
    }

    const fresh = (await this.memoryDelegate().findFirst({
      where: { id: memoryId },
    })) as StmRow | null;
    if (!fresh) {
      throw new StmMemoryNotFoundError(memoryId);
    }
    this.logger.debug(`STM memory updated: ${memoryId}`);
    return this.toStmMemory(fresh);
  }

  /**
   * Delete a short-term memory. A scope mismatch is treated as not-found so a
   * caller bound to one namespace cannot delete another's memory.
   */
  async delete(
    userId: string,
    memoryId: string,
    organizationId?: string,
    scope?: string
  ): Promise<void> {
    if (scope !== undefined) {
      const row = await this.fetchActive(userId, memoryId, organizationId).catch(
        (error: unknown) => {
          if (error instanceof StmMemoryExpiredError) {
            throw new StmMemoryNotFoundError(memoryId);
          }
          throw error;
        }
      );
      if ((row.scope ?? undefined) !== scope) {
        throw new StmMemoryNotFoundError(memoryId);
      }
    }

    const result = await this.memoryDelegate().deleteMany({
      where: {
        id: memoryId,
        userId,
        organizationId: organizationId ?? null,
        type: MemoryType.SHORT_TERM,
        // An already-expired row is gone as far as callers are concerned
        // (parity with Redis, where the key has vanished).
        expiresAt: { gt: new Date() },
      },
    });

    if (result.count === 0) {
      throw new StmMemoryNotFoundError(memoryId);
    }
    this.logger.debug(`STM memory deleted: ${memoryId}`);
  }

  /**
   * List short-term memories for a user with cursor pagination and filtering.
   * The cursor contract matches the prior adapters: `'0'` is the start
   * sentinel; `endCursor` is `'0'` when there are no further pages.
   */
  async list(
    userId: string,
    options: Partial<ListStmOptionsData> = {}
  ): Promise<PaginatedResult<StmMemory>> {
    const limit = options.limit ?? 20;
    const cursor = options.cursor ?? '0';
    const tags = options.tags ?? [];
    const scope = options.scope;

    const where = this.buildListWhere(userId, {
      tags,
      organizationId: options.organizationId,
      scope,
    });

    const rows = (await this.memoryDelegate().findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor !== '0' ? { cursor: { id: cursor }, skip: 1 } : {}),
    })) as StmRow[];

    const hasNextPage = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => this.toStmMemory(row));
    const totalCount = await this.count(userId, {
      tags,
      organizationId: options.organizationId,
      scope,
    });

    return {
      items,
      totalCount,
      hasNextPage,
      hasPreviousPage: cursor !== '0',
      startCursor: cursor,
      endCursor: hasNextPage && items.length > 0 ? items[items.length - 1]!.id : '0',
    };
  }

  /**
   * Get the remaining TTL (in seconds) for a memory. Missing and expired
   * memories both surface as not-found (parity with Redis TTL=-2).
   */
  async getTtl(userId: string, memoryId: string, organizationId?: string): Promise<number> {
    let row: StmRow;
    try {
      row = await this.fetchActive(userId, memoryId, organizationId);
    } catch (error) {
      if (error instanceof StmMemoryExpiredError) {
        throw new StmMemoryNotFoundError(memoryId);
      }
      throw error;
    }

    if (!row.expiresAt) {
      this.logger.warn(`STM memory ${memoryId} has no expiry set`);
      return 0;
    }
    return Math.max(0, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000));
  }

  /**
   * Extend a memory's TTL by `additionalSeconds` (new total = remaining +
   * additional, validated against the TTL bounds).
   */
  async extendTtl(
    userId: string,
    memoryId: string,
    additionalSeconds: number,
    organizationId?: string
  ): Promise<StmMemory> {
    const existing = await this.findById(userId, memoryId, organizationId);
    const currentTtl = await this.getTtl(userId, memoryId, organizationId);
    const newTtl = currentTtl + additionalSeconds;
    this.validateTtl(newTtl);
    return this.update(userId, memoryId, { ttl: newTtl, tags: existing.tags }, organizationId);
  }

  /**
   * Count short-term memories for a user with optional tag/scope filtering.
   */
  async count(
    userId: string,
    options: { tags?: string[]; organizationId?: string; scope?: string } = {}
  ): Promise<number> {
    const where = this.buildListWhere(userId, options);
    return (await this.memoryDelegate().count({ where })) as number;
  }

  /**
   * Delete every personal (or org-scoped, when `organizationId` is given)
   * short-term memory for a user. Returns the number of removed rows.
   */
  async clear(userId: string, organizationId?: string): Promise<number> {
    const result = await this.memoryDelegate().deleteMany({
      where: {
        userId,
        organizationId: organizationId ?? null,
        type: MemoryType.SHORT_TERM,
      },
    });
    this.logger.debug(`Cleared ${result.count} STM memories for user: ${userId}`);
    return result.count as number;
  }

  /**
   * Find short-term memories with `accessCount >= threshold` for a user (or
   * globally when `userId` is omitted). Used by the consolidation job to
   * identify promotion candidates.
   */
  async findCandidates(threshold: number, userId?: string): Promise<StmMemory[]> {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error(
        `Invalid consolidation threshold: ${threshold}. Must be a positive finite number.`
      );
    }

    const rows = (await this.memoryDelegate().findMany({
      where: {
        type: MemoryType.SHORT_TERM,
        expiresAt: { gt: new Date() },
        metadata: { path: ['accessCount'], gte: threshold },
        // With a userId the scan is restricted to personal memories, matching
        // the Redis pattern semantics; the global scan covers org rows too.
        ...(userId ? { userId, organizationId: null } : {}),
      },
    })) as StmRow[];

    const candidates = rows.map((row) => this.toStmMemory(row));
    this.logger.debug(`Found ${candidates.length} consolidation candidate(s)`);
    return candidates;
  }

  /**
   * Promotion hand-off: return the source memory so callers can chain into
   * the LTM service, which performs the durable transfer.
   */
  async promote(userId: string, memoryId: string, organizationId?: string): Promise<StmMemory> {
    return this.findById(userId, memoryId, organizationId);
  }

  /**
   * Bulk-delete expired STM rows. Correctness never depends on this (every
   * read filters on `expiresAt`); it is hygiene that keeps the table small.
   * Scheduled by the mcp-server's StmSweepService.
   */
  async sweepExpired(): Promise<number> {
    const result = await this.memoryDelegate().deleteMany({
      where: { type: MemoryType.SHORT_TERM, expiresAt: { lte: new Date() } },
    });
    if (result.count > 0) {
      this.logger.debug(`Swept ${result.count} expired STM memories`);
    }
    return result.count as number;
  }

  // ── private helpers ─────────────────────────────────────────────────────

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
   * house style: packages access Prisma delegates untyped so they build
   * before the generated client exists (see MemoryLtmService). */
  private memoryDelegate(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).memory;
  }

  /**
   * Fetch a live STM row or throw. Expired rows are deleted on touch and
   * surface as `StmMemoryExpiredError`.
   */
  private async fetchActive(
    userId: string,
    memoryId: string,
    organizationId?: string
  ): Promise<StmRow> {
    const row = (await this.memoryDelegate().findFirst({
      where: {
        id: memoryId,
        userId,
        organizationId: organizationId ?? null,
        type: MemoryType.SHORT_TERM,
      },
    })) as StmRow | null;

    if (!row) {
      throw new StmMemoryNotFoundError(memoryId);
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      await this.memoryDelegate().deleteMany({ where: { id: memoryId } });
      throw new StmMemoryExpiredError(memoryId);
    }
    return row;
  }

  private buildListWhere(
    userId: string,
    options: { tags?: string[]; organizationId?: string; scope?: string }
  ): Record<string, unknown> {
    const tags = options.tags ?? [];
    return {
      userId,
      organizationId: options.organizationId ?? null,
      type: MemoryType.SHORT_TERM,
      expiresAt: { gt: new Date() },
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      // Tag filtering is match-any, mirroring the prior adapters.
      ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
    };
  }

  /** Stamp the adapter-managed keys into a metadata object (house style —
   * LTM keeps `accessCount`/`importance` in metadata the same way). */
  private stampMetadata(
    base: Record<string, unknown>,
    accessCount: number,
    ttl: number
  ): Record<string, unknown> {
    return { ...base, accessCount, ttl };
  }

  private readAccessCount(metadata: Record<string, unknown> | null): number {
    const value = metadata?.['accessCount'];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  /** Stored full-TTL window; falls back to the create-time window for rows
   * written without the stamp. */
  private readTtl(row: StmRow): number {
    const value = row.metadata?.['ttl'];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (row.expiresAt) {
      return Math.max(
        this.config.minTtl,
        Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 1000)
      );
    }
    return this.config.defaultTtl;
  }

  private toStmMemory(row: StmRow): StmMemory {
    return {
      id: row.id,
      userId: row.userId,
      organizationId: row.organizationId ?? undefined,
      scope: row.scope ?? undefined,
      content: row.content,
      metadata: row.metadata,
      tags: row.tags,
      type: 'short-term',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // STM rows always carry an expiry; guard for hand-edited rows.
      expiresAt: row.expiresAt ?? new Date(row.createdAt.getTime() + this.config.defaultTtl * 1000),
      ttl: this.readTtl(row),
      embedding: row.embedding,
      accessCount: this.readAccessCount(row.metadata),
      version: row.version ?? 1,
    };
  }

  private validateTtl(ttl: number): void {
    if (ttl < this.config.minTtl || ttl > this.config.maxTtl) {
      throw new StmTtlValidationError(ttl, this.config.minTtl, this.config.maxTtl);
    }
  }
}
