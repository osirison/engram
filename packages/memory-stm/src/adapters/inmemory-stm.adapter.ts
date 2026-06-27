import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EmbeddingsService } from '@engram/embeddings';
import {
  StmMemory,
  CreateStmMemoryData,
  UpdateStmMemoryData,
  ListStmOptionsData,
  PaginatedResult,
  StmKeyBuilder,
  StmMemoryNotFoundError,
  StmMemoryExpiredError,
  StmTtlValidationError,
  DEFAULT_STM_CONFIG,
  StmConfig,
  createStmMemorySchema,
  updateStmMemorySchema,
} from '../types';

/**
 * In-process short-term memory adapter.
 *
 * Profile-memory uses this instead of Redis to provide a zero-dependency
 * onboarding path. State is held in a `Map` keyed by the same
 * `StmKeyBuilder.buildMemoryKey()` format the Redis service uses, so the
 * semantics of `findById`/`delete`/etc. are identical to the production
 * service. Entries auto-expire via `setTimeout`; expired entries are
 * lazily pruned on read and on `clear()`.
 *
 * Limitations:
 *  - No persistence: the process holds all state in memory only.
 *  - No cross-instance sharing: a multi-process deployment that picks the
 *    in-memory adapter will see per-process state.
 *  - `scan()` is implemented as an in-memory iteration; cursor paging is
 *    faked by always returning the sentinel `'0'` after the first page so
 *    consumers can reuse the existing pagination contract.
 */
@Injectable()
export class InMemoryStmAdapter {
  private readonly logger = new Logger(InMemoryStmAdapter.name);
  private readonly keyBuilder: StmKeyBuilder;
  private readonly config: StmConfig;
  private readonly store = new Map<string, StmMemory>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(@Optional() private readonly embeddingsService?: EmbeddingsService) {
    this.config = { ...DEFAULT_STM_CONFIG };
    this.keyBuilder = new StmKeyBuilder(this.config.keyPrefix);
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

    const memory: StmMemory = {
      id: memoryId,
      userId: validated.userId,
      organizationId: validated.organizationId,
      content: validated.content,
      metadata: validated.metadata ?? null,
      tags: validated.tags ?? [],
      type: 'short-term',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      ttl,
      embedding,
      accessCount: 0,
    };

    const key = this.keyBuilder.buildMemoryKey(
      validated.userId,
      memoryId,
      validated.organizationId
    );
    this.store.set(key, memory);
    this.scheduleExpiry(key, ttl);

    this.logger.debug(`InMemory STM created: ${memoryId}`);
    return memory;
  }

  /**
   * Retrieve a short-term memory by ID. Throws `StmMemoryNotFoundError` if
   * the entry is missing or expired; expired entries are pruned as a
   * side-effect to keep the map small.
   */
  async findById(userId: string, memoryId: string, organizationId?: string): Promise<StmMemory> {
    const key = this.keyBuilder.buildMemoryKey(userId, memoryId, organizationId);
    const memory = this.store.get(key);
    if (!memory) {
      throw new StmMemoryNotFoundError(memoryId);
    }
    if (memory.expiresAt && new Date() > new Date(memory.expiresAt)) {
      this.removeKey(key);
      throw new StmMemoryExpiredError(memoryId);
    }

    const updated: StmMemory = {
      ...memory,
      accessCount: (memory.accessCount ?? 0) + 1,
    };
    this.store.set(key, updated);
    return updated;
  }

  /**
   * Update a short-term memory. Preserves the original id, userId, type
   * and createdAt. `ttl` is optional; when supplied it is clamped and
   * triggers a fresh expiry timer.
   */
  async update(
    userId: string,
    memoryId: string,
    input: UpdateStmMemoryData,
    organizationId?: string
  ): Promise<StmMemory> {
    const validated = updateStmMemorySchema.parse(input);
    const key = this.keyBuilder.buildMemoryKey(userId, memoryId, organizationId);
    const existing = this.store.get(key);
    if (!existing) {
      throw new StmMemoryNotFoundError(memoryId);
    }
    if (existing.expiresAt && new Date() > new Date(existing.expiresAt)) {
      this.removeKey(key);
      throw new StmMemoryExpiredError(memoryId);
    }

    const newTtl = validated.ttl ?? existing.ttl;
    this.validateTtl(newTtl);
    const now = new Date();
    // Only reset expiresAt when the caller explicitly provides a new TTL;
    // preserving the original expiry matches Redis behaviour where HSET
    // does not reset the key's EXPIRE unless PEXPIREAT is also called.
    const expiresAt =
      validated.ttl !== undefined ? new Date(now.getTime() + newTtl * 1000) : existing.expiresAt;

    const updated: StmMemory = {
      ...existing,
      content: validated.content ?? existing.content,
      metadata: validated.metadata !== undefined ? validated.metadata : existing.metadata,
      tags: validated.tags ?? existing.tags,
      updatedAt: now,
      expiresAt,
      ttl: newTtl,
    };
    this.store.set(key, updated);
    if (validated.ttl !== undefined) {
      this.scheduleExpiry(key, newTtl);
    }
    return updated;
  }

  /**
   * Delete a short-term memory.
   */
  async delete(userId: string, memoryId: string, organizationId?: string): Promise<void> {
    const key = this.keyBuilder.buildMemoryKey(userId, memoryId, organizationId);
    if (!this.store.has(key)) {
      throw new StmMemoryNotFoundError(memoryId);
    }
    this.removeKey(key);
  }

  /**
   * List short-term memories for a user. Tag filtering and pagination are
   * applied in-memory. The cursor contract matches the Redis-backed
   * implementation: `'0'` is the start sentinel and the response uses the
   * returned cursor verbatim.
   */
  async list(
    userId: string,
    options: Partial<ListStmOptionsData> = {}
  ): Promise<PaginatedResult<StmMemory>> {
    const limit = options.limit ?? 20;
    const tags = options.tags ?? [];
    const orgId = options.organizationId;

    const prefix = this.keyBuilder.buildUserPattern(userId, orgId);
    const matches: StmMemory[] = [];
    for (const [key, value] of this.store.entries()) {
      if (!key.startsWith(prefix.replace('*', ''))) {
        continue;
      }
      if (value.expiresAt && new Date() > new Date(value.expiresAt)) {
        this.removeKey(key);
        continue;
      }
      if (tags.length > 0 && !tags.some((t) => value.tags.includes(t))) {
        continue;
      }
      matches.push(value);
    }
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const totalCount = matches.length;
    const items = matches.slice(0, limit);
    return {
      items,
      totalCount,
      hasNextPage: matches.length > limit,
      hasPreviousPage: false,
      startCursor: '0',
      endCursor: '0',
    };
  }

  /**
   * Get the remaining TTL (in seconds) for a memory. Returns 0 when the
   * entry has no expiry (mirrors Redis behaviour with TTL = -1).
   */
  async getTtl(userId: string, memoryId: string, organizationId?: string): Promise<number> {
    const key = this.keyBuilder.buildMemoryKey(userId, memoryId, organizationId);
    const memory = this.store.get(key);
    if (!memory) {
      throw new StmMemoryNotFoundError(memoryId);
    }
    if (!memory.expiresAt) {
      return 0;
    }
    const remainingMs = memory.expiresAt.getTime() - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  /**
   * Extend a memory's TTL by `additionalSeconds`. The new total TTL is
   * clamped via `validateTtl`.
   */
  async extendTtl(
    userId: string,
    memoryId: string,
    additionalSeconds: number,
    organizationId?: string
  ): Promise<StmMemory> {
    const existing = await this.findById(userId, memoryId, organizationId);
    const currentTtl = await this.getTtl(userId, memoryId, organizationId);
    return this.update(
      userId,
      memoryId,
      { ttl: currentTtl + additionalSeconds, tags: existing.tags },
      organizationId
    );
  }

  /**
   * Count short-term memories for a user (optionally filtered by tag).
   */
  async count(
    userId: string,
    options: { tags?: string[]; organizationId?: string } = {}
  ): Promise<number> {
    const list = await this.list(userId, {
      limit: Number.MAX_SAFE_INTEGER,
      tags: options.tags,
      organizationId: options.organizationId,
    });
    return list.totalCount;
  }

  /**
   * Delete every short-term memory for a user (optionally scoped to an
   * organization). Returns the number of removed entries.
   */
  async clear(userId: string, organizationId?: string): Promise<number> {
    const prefix = this.keyBuilder.buildUserPattern(userId, organizationId);
    let deleted = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix.replace('*', ''))) {
        this.removeKey(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  /**
   * Find short-term memories with `accessCount >= threshold` for a user
   * (or globally when `userId` is omitted). Used by the consolidation job
   * to identify promotion candidates.
   */
  async findCandidates(threshold: number, userId?: string): Promise<StmMemory[]> {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error(
        `Invalid consolidation threshold: ${threshold}. Must be a positive finite number.`
      );
    }
    const candidates: StmMemory[] = [];
    for (const [key, value] of this.store.entries()) {
      if (userId) {
        const extracted = this.keyBuilder.extractUserId(key);
        if (extracted !== userId) {
          continue;
        }
      }
      if (value.expiresAt && new Date() > new Date(value.expiresAt)) {
        this.removeKey(key);
        continue;
      }
      if ((value.accessCount ?? 0) >= threshold) {
        candidates.push(value);
      }
    }
    return candidates;
  }

  /**
   * Promote a short-term memory to a long-term representation. The
   * in-process adapter returns a minimal "long-term" projection so the
   * `MemoryStmService` callers (consolidation) can chain into the LTM
   * adapter without touching Redis. The caller is expected to hand the
   * payload to the LTM adapter for durable storage.
   */
  async promote(userId: string, memoryId: string, organizationId?: string): Promise<StmMemory> {
    // promote() in the Redis-backed service performs the actual transfer;
    // the in-process adapter simply returns the source memory so callers
    // can chain into a profile-aware LTM adapter that handles persistence.
    return this.findById(userId, memoryId, organizationId);
  }

  // ── private helpers ─────────────────────────────────────────────────────

  private scheduleExpiry(key: string, ttlSeconds: number): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.removeKey(key);
    }, ttlSeconds * 1000);
    // Don't keep the Node event loop alive solely for expiry timers.
    timer.unref?.();
    this.timers.set(key, timer);
  }

  private removeKey(key: string): void {
    this.store.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  private validateTtl(ttl: number): void {
    if (ttl < this.config.minTtl || ttl > this.config.maxTtl) {
      throw new StmTtlValidationError(ttl, this.config.minTtl, this.config.maxTtl);
    }
  }
}
