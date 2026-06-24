import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EmbeddingsService } from '@engram/embeddings';
import { type Memory } from '@engram/database';
import { STM_PROVIDER } from '@engram/memory-stm';
import {
  LtmMemory,
  CreateLtmMemoryData,
  UpdateLtmMemoryData,
  LtmQueryOptions,
  LtmConfig,
  DEFAULT_LTM_CONFIG,
  LtmMemoryNotFoundError,
  LtmMemoryQuotaExceededError,
  LtmPromotionError,
  LtmDatabaseError,
  SemanticSearchOptions,
  SemanticSearchResult,
  ReindexOptions,
  ReindexResult,
  validateCreateLtmMemory,
  validateUpdateLtmMemory,
  validateLtmQueryOptions,
} from '../types';

/**
 * In-process long-term memory adapter.
 *
 * Profile-memory uses this instead of Postgres to provide a
 * zero-dependency onboarding path. Memories are stored in a `Map` keyed
 * by id with an additional user-index for fast list/find operations.
 *
 * Limitations:
 *  - No persistence: state lives in the process memory only.
 *  - `semanticSearch()` returns `[]` because there is no vector store in
 *    profile-memory. The hybrid retriever (Step 2.3) is the
 *    profile-memory replacement for vector recall.
 *  - `reindex()` is a no-op (returns an empty summary) because there is
 *    no external vector store to backfill.
 *
 * Type guarantee: this class implements the same public surface as
 * `MemoryLtmService` (minus DB-only helpers), so consumers that depend
 * on the LTM_PROVIDER token get a compatible contract in any profile.
 */
@Injectable()
export class InMemoryLtmAdapter {
  private readonly config: LtmConfig;
  private readonly memories = new Map<string, LtmMemory>();
  private readonly byUser = new Map<string, Set<string>>();

  constructor(
    @Optional() private readonly embeddingsService?: EmbeddingsService,
    @Optional() @Inject(STM_PROVIDER) private readonly stmProvider?: unknown
  ) {
    this.config = { ...DEFAULT_LTM_CONFIG };
  }

  async create(input: CreateLtmMemoryData): Promise<LtmMemory> {
    const validated = validateCreateLtmMemory(input);
    try {
      await this.checkQuota(validated.userId);

      let embedding: number[] = [];
      if (this.embeddingsService) {
        const result = await this.embeddingsService
          .generate({ text: validated.content })
          .catch(() => null);
        embedding = result?.embedding ?? [];
      }

      const now = new Date();
      const memory: LtmMemory = {
        id: randomUUID(),
        userId: validated.userId,
        organizationId: validated.organizationId,
        content: validated.content,
        metadata: validated.metadata ?? null,
        tags: validated.tags ?? [],
        type: 'long-term',
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
        embedding,
      };

      this.memories.set(memory.id, memory);
      this.indexForUser(memory);

      return memory;
    } catch (error) {
      if (error instanceof LtmMemoryQuotaExceededError) {
        throw error;
      }
      throw new LtmDatabaseError('create', error instanceof Error ? error.message : String(error));
    }
  }

  async get(userId: string, memoryId: string, organizationId?: string): Promise<LtmMemory | null> {
    const memory = this.memories.get(memoryId);
    if (!memory || memory.userId !== userId) {
      return null;
    }
    if (organizationId !== undefined && memory.organizationId !== organizationId) {
      return null;
    }
    return memory;
  }

  async update(
    userId: string,
    memoryId: string,
    input: UpdateLtmMemoryData,
    organizationId?: string
  ): Promise<LtmMemory> {
    const validated = validateUpdateLtmMemory(input);
    const existing = await this.get(userId, memoryId, organizationId);
    if (!existing) {
      throw new LtmMemoryNotFoundError(memoryId);
    }
    let embedding = existing.embedding;
    if (validated.content !== undefined && this.embeddingsService) {
      const result = await this.embeddingsService
        .generate({ text: validated.content })
        .catch(() => null);
      if (result?.embedding) {
        embedding = result.embedding;
      }
    }
    const nextMetadata: Record<string, unknown> | null =
      validated.metadata !== undefined
        ? (validated.metadata ?? null)
        : validated.metadataMerge !== undefined
          ? { ...(existing.metadata ?? {}), ...validated.metadataMerge }
          : (existing.metadata ?? null);
    const updated: LtmMemory = {
      ...existing,
      content: validated.content ?? existing.content,
      tags: validated.tags ?? existing.tags,
      metadata: nextMetadata,
      embedding,
      updatedAt: new Date(),
    };
    this.memories.set(updated.id, updated);
    return updated;
  }

  async delete(userId: string, memoryId: string, organizationId?: string): Promise<boolean> {
    const memory = await this.get(userId, memoryId, organizationId);
    if (!memory) {
      return false;
    }
    this.memories.delete(memoryId);
    this.deindexForUser(memory);
    return true;
  }

  async list(
    userId: string,
    options?: LtmQueryOptions
  ): Promise<{
    items: LtmMemory[];
    totalCount: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor?: string;
    endCursor?: string;
  }> {
    const validated = validateLtmQueryOptions(options ?? {});
    const ids = this.byUser.get(userId);
    if (!ids) {
      return {
        items: [],
        totalCount: 0,
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: undefined,
        endCursor: undefined,
      };
    }
    const matches: LtmMemory[] = [];
    for (const id of ids) {
      const m = this.memories.get(id);
      if (!m) continue;
      if (validated.organizationId && m.organizationId !== validated.organizationId) {
        continue;
      }
      if (validated.tags && validated.tags.length > 0) {
        if (!validated.tags.some((t) => m.tags.includes(t))) {
          continue;
        }
      }
      if (validated.search) {
        if (!m.content.toLowerCase().includes(validated.search.toLowerCase())) {
          continue;
        }
      }
      if (validated.dateFrom && m.createdAt < validated.dateFrom) {
        continue;
      }
      if (validated.dateTo && m.createdAt > validated.dateTo) {
        continue;
      }
      matches.push(m);
    }
    matches.sort((a, b) => {
      const order = validated.sortOrder === 'asc' ? 1 : -1;
      if (validated.sortBy === 'updatedAt') {
        return order * (a.updatedAt.getTime() - b.updatedAt.getTime());
      }
      return order * (a.createdAt.getTime() - b.createdAt.getTime());
    });
    const totalCount = matches.length;
    const start = validated.cursor ? matches.findIndex((m) => m.id === validated.cursor) + 1 : 0;
    const end = start + validated.limit;
    const page = matches.slice(start, end);
    return {
      items: page,
      totalCount,
      hasNextPage: end < matches.length,
      hasPreviousPage: start > 0,
      startCursor: page[0]?.id,
      endCursor: page[page.length - 1]?.id,
    };
  }

  async count(userId: string, filters?: Partial<LtmQueryOptions>): Promise<number> {
    const result = await this.list(userId, filters);
    return result.totalCount;
  }

  async clear(userId: string): Promise<number> {
    const ids = this.byUser.get(userId);
    if (!ids) {
      return 0;
    }
    let deleted = 0;
    for (const id of [...ids]) {
      const memory = this.memories.get(id);
      if (memory) {
        this.memories.delete(id);
        deleted += 1;
      }
    }
    this.byUser.delete(userId);
    return deleted;
  }

  async promote(userId: string, memoryId: string, organizationId?: string): Promise<LtmMemory> {
    // The STM adapter hands the source payload back to callers; in
    // profile-memory the in-process LTM adapter is responsible for
    // creating the durable row, so we just create from a synthetic
    // payload built from the source memory.
    const source = await this.findSourceFromStm(userId, memoryId, organizationId);
    if (!source) {
      throw new LtmPromotionError(memoryId, 'Source STM memory not found');
    }
    return this.create({
      userId: source.userId,
      organizationId: source.organizationId ?? undefined,
      content: source.content,
      metadata: source.metadata ?? undefined,
      tags: source.tags,
    });
  }

  /**
   * Semantic search is unsupported in profile-memory because there is no
   * vector store. Returns an empty array so callers that do not check for
   * `null` continue to work.
   */
  async semanticSearch(
    _userId: string,
    _query: string,
    _options?: SemanticSearchOptions
  ): Promise<SemanticSearchResult[]> {
    return [];
  }

  /**
   * Reindex is a no-op in profile-memory because there is no vector
   * store to backfill. Returns an empty summary so callers can chain
   * the result.
   */
  async reindex(_options: ReindexOptions = {}): Promise<ReindexResult> {
    return { processed: 0, indexed: 0, skipped: 0, failed: 0, cursor: null };
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async checkQuota(userId: string): Promise<void> {
    const ids = this.byUser.get(userId);
    const current = ids ? ids.size : 0;
    if (current >= this.config.maxMemoriesPerUser) {
      throw new LtmMemoryQuotaExceededError(userId, this.config.maxMemoriesPerUser);
    }
  }

  private indexForUser(memory: LtmMemory): void {
    let ids = this.byUser.get(memory.userId);
    if (!ids) {
      ids = new Set();
      this.byUser.set(memory.userId, ids);
    }
    ids.add(memory.id);
  }

  private deindexForUser(memory: LtmMemory): void {
    const ids = this.byUser.get(memory.userId);
    if (ids) {
      ids.delete(memory.id);
      if (ids.size === 0) {
        this.byUser.delete(memory.userId);
      }
    }
  }

  /**
   * Look up a source STM memory through the in-process STM adapter when
   * the consumer has injected the `STM_PROVIDER` symbol. The provider
   * surface is typed loosely here because the LTM package must not
   * depend on a specific STM implementation; we duck-type the read
   * method we need.
   */
  private async findSourceFromStm(
    userId: string,
    memoryId: string,
    organizationId?: string
  ): Promise<Memory | null> {
    if (!this.stmProvider) {
      return null;
    }
    const provider = this.stmProvider as {
      findById?: (
        userId: string,
        memoryId: string,
        organizationId?: string
      ) => Promise<Memory | null>;
    };
    if (typeof provider.findById !== 'function') {
      return null;
    }
    try {
      return await provider.findById(userId, memoryId, organizationId);
    } catch {
      return null;
    }
  }
}
