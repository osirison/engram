import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import { MemoryType, PaginatedResult } from '@engram/database';
import { MemoryStmService } from '@engram/memory-stm';
import { EmbeddingsService } from '@engram/embeddings';
import { VECTOR_STORE_TOKEN, type VectorStore, type VectorPayload } from '@engram/vector-store';
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
} from './types';

// Type for Prisma Memory result - temporary until Prisma types are properly configured
type PrismaMemory = {
  id: string;
  userId: string;
  content: string;
  metadata: unknown; // Using unknown for type safety; must be type-checked before use
  tags: string[];
  type: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  embedding: number[];
};

@Injectable()
export class MemoryLtmService {
  private readonly logger = new Logger(MemoryLtmService.name);
  private readonly config: LtmConfig;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly stmService?: MemoryStmService,
    @Optional() private readonly embeddingsService?: EmbeddingsService,
    @Optional()
    @Inject(VECTOR_STORE_TOKEN)
    private readonly vectorStore?: VectorStore
  ) {
    this.config = { ...DEFAULT_LTM_CONFIG };
    // Use prisma to avoid unused variable warning
    // TODO: Remove this workaround once Prisma types are properly configured and the actual implementation uses `this.prisma`
    void this.prisma;
  }

  /**
   * Create a new long-term memory
   */
  async create(input: CreateLtmMemoryData): Promise<LtmMemory> {
    this.logger.debug(`Creating LTM memory for user: ${input.userId}`);

    // Validate input
    const validatedInput = validateCreateLtmMemory(input);

    try {
      // Check if user has exceeded quota
      await this.checkQuota(validatedInput.userId);

      // Generate embedding (non-fatal — memory creation succeeds even if this
      // fails or the API key is absent).
      let embedding: number[] = [];
      if (this.embeddingsService) {
        const result = await this.embeddingsService
          .generate({ text: validatedInput.content })
          .catch(() => null);
        embedding = result?.embedding ?? [];
      }

      // Create memory in database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memory = await (this.prisma as any).memory.create({
        data: {
          userId: validatedInput.userId,
          content: validatedInput.content,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          metadata: validatedInput.metadata as any,
          tags: validatedInput.tags || [],
          type: MemoryType.LONG_TERM,
          expiresAt: null,
          embedding,
        },
      });

      this.logger.debug(`LTM memory created: ${memory.id}`);
      const ltmMemory = this.mapToLtmMemory(memory);

      // Mirror the embedding into the vector store for semantic recall
      // (non-fatal — Postgres remains the source of truth).
      await this.indexVector(ltmMemory, embedding);

      return ltmMemory;
    } catch (error) {
      if (error instanceof LtmMemoryQuotaExceededError) {
        throw error;
      }
      this.logger.error(`Failed to create LTM memory: ${error}`);
      throw new LtmDatabaseError('create', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Retrieve a long-term memory by ID
   */
  async get(userId: string, memoryId: string): Promise<LtmMemory | null> {
    this.logger.debug(`Getting LTM memory: ${memoryId} for user: ${userId}`);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memory = await (this.prisma as any).memory.findFirst({
        where: {
          id: memoryId,
          userId: userId,
          type: MemoryType.LONG_TERM,
        },
      });

      if (!memory) {
        return null;
      }

      return this.mapToLtmMemory(memory);
    } catch (error) {
      this.logger.error(`Failed to get LTM memory ${memoryId}: ${error}`);
      throw new LtmDatabaseError('get', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Update a long-term memory
   */
  async update(userId: string, memoryId: string, input: UpdateLtmMemoryData): Promise<LtmMemory> {
    this.logger.debug(`Updating LTM memory: ${memoryId} for user: ${userId}`);

    // Validate input
    const validatedInput = validateUpdateLtmMemory(input);

    try {
      // Check if memory exists and belongs to user
      const existing = await this.get(userId, memoryId);
      if (!existing) {
        throw new LtmMemoryNotFoundError(memoryId);
      }

      // Prepare update data (only include fields that are provided)
      const updateData: Record<string, unknown> = {};

      if (validatedInput.content !== undefined) {
        updateData.content = validatedInput.content;
      }
      if (validatedInput.metadata !== undefined) {
        updateData.metadata = validatedInput.metadata || null;
      }
      if (validatedInput.tags !== undefined) {
        updateData.tags = validatedInput.tags || [];
      }

      // Re-embed when the content changes so the vector stays consistent with
      // the stored text (non-fatal — falls back to the existing embedding).
      let newEmbedding: number[] | undefined;
      if (validatedInput.content !== undefined && this.embeddingsService) {
        const result = await this.embeddingsService
          .generate({ text: validatedInput.content })
          .catch(() => null);
        if (result?.embedding) {
          newEmbedding = result.embedding;
          updateData.embedding = newEmbedding;
        }
      }

      // Update memory in database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memory = await (this.prisma as any).memory.update({
        where: {
          id: memoryId,
          userId: userId,
          type: MemoryType.LONG_TERM,
        },
        data: updateData,
      });

      this.logger.debug(`LTM memory updated: ${memoryId}`);
      const ltmMemory = this.mapToLtmMemory(memory);

      // Re-index whenever the embedding, tags, or scope-bearing metadata change.
      const embeddingToIndex = newEmbedding ?? ltmMemory.embedding;
      if (
        embeddingToIndex.length > 0 &&
        (newEmbedding !== undefined ||
          validatedInput.tags !== undefined ||
          validatedInput.metadata !== undefined)
      ) {
        await this.indexVector(ltmMemory, embeddingToIndex);
      }

      return ltmMemory;
    } catch (error) {
      if (error instanceof LtmMemoryNotFoundError) {
        throw error;
      }
      this.logger.error(`Failed to update LTM memory ${memoryId}: ${error}`);
      throw new LtmDatabaseError('update', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Delete a long-term memory
   */
  async delete(userId: string, memoryId: string): Promise<boolean> {
    this.logger.debug(`Deleting LTM memory: ${memoryId} for user: ${userId}`);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.prisma as any).memory.deleteMany({
        where: {
          id: memoryId,
          userId: userId,
          type: MemoryType.LONG_TERM,
        },
      });

      const deleted = result.count > 0;
      if (deleted) {
        this.logger.debug(`LTM memory deleted: ${memoryId}`);
        // Best-effort removal from the vector store (non-fatal).
        await this.removeVector([memoryId]);
      } else {
        this.logger.debug(`LTM memory not found for deletion: ${memoryId}`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete LTM memory ${memoryId}: ${error}`);
      throw new LtmDatabaseError('delete', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * List long-term memories for a user with pagination and filtering
   */
  async list(userId: string, options?: LtmQueryOptions): Promise<PaginatedResult<LtmMemory>> {
    this.logger.debug(`Listing LTM memories for user: ${userId}`);

    // Validate and set defaults for options
    const validatedOptions = validateLtmQueryOptions(options || {});

    try {
      // Build where clause
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const whereClause: any = {
        userId: userId,
        type: MemoryType.LONG_TERM,
      };

      // Add filters
      if (validatedOptions.tags && validatedOptions.tags.length > 0) {
        whereClause.tags = {
          hasSome: validatedOptions.tags,
        };
      }

      if (validatedOptions.dateFrom || validatedOptions.dateTo) {
        whereClause.createdAt = {};
        if (validatedOptions.dateFrom) {
          whereClause.createdAt.gte = validatedOptions.dateFrom;
        }
        if (validatedOptions.dateTo) {
          whereClause.createdAt.lte = validatedOptions.dateTo;
        }
      }

      if (validatedOptions.search) {
        whereClause.content = {
          contains: validatedOptions.search,
          mode: 'insensitive',
        };
      }

      // Handle cursor-based pagination
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderBy: any = { [validatedOptions.sortBy]: validatedOptions.sortOrder };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findManyOptions: any = {
        where: whereClause,
        orderBy,
        take: validatedOptions.limit + 1, // +1 to check if there's a next page
        skip: validatedOptions.cursor ? 1 : 0,
      };

      if (validatedOptions.cursor) {
        findManyOptions.cursor = { id: validatedOptions.cursor };
      }

      // Get total count and memories

      const [totalCount, memories] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.prisma as any).memory.count({ where: whereClause }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.prisma as any).memory.findMany(findManyOptions),
      ]);

      // Check if there are more pages
      const hasNextPage = memories.length > validatedOptions.limit;
      if (hasNextPage) {
        memories.pop(); // Remove the extra item
      }

      // Map to LTM memories
      const ltmMemories = memories.map((memory: PrismaMemory) => this.mapToLtmMemory(memory));

      // Build pagination info
      const result: PaginatedResult<LtmMemory> = {
        items: ltmMemories,
        totalCount,
        hasNextPage,
        hasPreviousPage: !!validatedOptions.cursor,
        startCursor: ltmMemories.length > 0 ? ltmMemories[0]?.id : undefined,
        endCursor: ltmMemories.length > 0 ? ltmMemories[ltmMemories.length - 1]?.id : undefined,
      };

      this.logger.debug(`Listed ${ltmMemories.length} LTM memories for user: ${userId}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to list LTM memories for user ${userId}: ${error}`);
      throw new LtmDatabaseError('list', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Count total long-term memories for a user
   */
  async count(userId: string, filters?: Partial<LtmQueryOptions>): Promise<number> {
    this.logger.debug(`Counting LTM memories for user: ${userId}`);

    try {
      // Build where clause
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const whereClause: any = {
        userId: userId,
        type: MemoryType.LONG_TERM,
      };

      // Add filters if provided
      if (filters?.tags && filters.tags.length > 0) {
        whereClause.tags = {
          hasSome: filters.tags,
        };
      }

      if (filters?.dateFrom || filters?.dateTo) {
        whereClause.createdAt = {};
        if (filters.dateFrom) {
          whereClause.createdAt.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          whereClause.createdAt.lte = filters.dateTo;
        }
      }

      if (filters?.search) {
        whereClause.content = {
          contains: filters.search,
          mode: 'insensitive',
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = await (this.prisma as any).memory.count({ where: whereClause });

      this.logger.debug(`Counted ${count} LTM memories for user: ${userId}`);
      return count;
    } catch (error) {
      this.logger.error(`Failed to count LTM memories for user ${userId}: ${error}`);
      throw new LtmDatabaseError('count', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Clear all long-term memories for a user
   */
  async clear(userId: string): Promise<number> {
    this.logger.debug(`Clearing all LTM memories for user: ${userId}`);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.prisma as any).memory.deleteMany({
        where: {
          userId: userId,
          type: MemoryType.LONG_TERM,
        },
      });

      this.logger.debug(`Cleared ${result.count} LTM memories for user: ${userId}`);
      return result.count;
    } catch (error) {
      this.logger.error(`Failed to clear LTM memories for user ${userId}: ${error}`);
      throw new LtmDatabaseError('clear', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Promote a memory from short-term to long-term storage
   * This method transfers a memory from Redis STM to PostgreSQL LTM
   */
  async promote(userId: string, memoryId: string): Promise<LtmMemory> {
    this.logger.debug(`Promoting memory ${memoryId} to LTM for user: ${userId}`);

    if (!this.stmService) {
      throw new LtmPromotionError(memoryId, 'STM service not available for promotion');
    }

    try {
      // Step 1: Get memory from STM service
      const stmMemory = await this.stmService.findById(userId, memoryId);
      if (!stmMemory) {
        throw new LtmPromotionError(memoryId, 'Memory not found in short-term storage');
      }

      // Step 2: Generate embedding before the transaction (I/O outside DB tx).
      let embedding: number[] = [];
      if (this.embeddingsService) {
        const result = await this.embeddingsService
          .generate({ text: stmMemory.content })
          .catch(() => null);
        embedding = result?.embedding ?? [];
      }

      // Step 3: Begin database transaction for atomic operation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.prisma as any).$transaction(async (prisma: any) => {
        // Check quota before creating
        await this.checkQuota(userId);

        // Create memory in LTM
        return await prisma.memory.create({
          data: {
            id: stmMemory.id,
            userId: stmMemory.userId,
            content: stmMemory.content,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            metadata: stmMemory.metadata as any,
            tags: stmMemory.tags,
            type: MemoryType.LONG_TERM,
            createdAt: stmMemory.createdAt,
            updatedAt: new Date(),
            expiresAt: null,
            embedding,
          },
        });
      });

      // Step 4: Delete from STM storage (only after successful LTM creation)
      try {
        await this.stmService.delete(userId, memoryId);
        this.logger.debug(`Successfully promoted memory ${memoryId} from STM to LTM`);
      } catch (stmDeleteError) {
        // Log warning but don't fail the operation since LTM creation succeeded
        this.logger.warn(
          `Failed to delete STM memory ${memoryId} after promotion: ${stmDeleteError}`
        );
      }

      const ltmMemory = this.mapToLtmMemory(result);

      // Step 5: Mirror embedding into vector store (non-fatal).
      await this.indexVector(ltmMemory, embedding);

      return ltmMemory;
    } catch (error) {
      if (error instanceof LtmPromotionError || error instanceof LtmMemoryQuotaExceededError) {
        throw error;
      }
      this.logger.error(`Failed to promote memory ${memoryId}: ${error}`);
      throw new LtmPromotionError(memoryId, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Check if user has exceeded memory quota
   */
  private async checkQuota(userId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentCount = await (this.prisma as any).memory.count({
      where: {
        userId: userId,
        type: MemoryType.LONG_TERM,
      },
    });

    this.logger.debug(
      `Quota check for user ${userId}: ${currentCount}/${this.config.maxMemoriesPerUser}`
    );

    if (currentCount >= this.config.maxMemoriesPerUser) {
      throw new LtmMemoryQuotaExceededError(userId, this.config.maxMemoriesPerUser);
    }
  }

  /**
   * Perform a semantic (vector) recall over a user's long-term memories.
   *
   * Embeds the query, runs a tenant-scoped kNN search in the vector store, then
   * hydrates the matching memories from Postgres and attaches similarity scores.
   * Returns an empty array when embeddings or the vector store are unavailable.
   */
  async semanticSearch(
    userId: string,
    query: string,
    options?: SemanticSearchOptions
  ): Promise<SemanticSearchResult[]> {
    this.logger.debug(`Semantic search for user: ${userId}`);

    if (!this.vectorStore) {
      this.logger.warn('Semantic search requested but no vector store is configured');
      return [];
    }
    if (!this.embeddingsService) {
      this.logger.warn('Semantic search requested but no embeddings service is configured');
      return [];
    }

    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      return [];
    }

    const limit = options?.limit ?? 10;

    try {
      const embeddingResult = await this.embeddingsService
        .generate({ text: trimmedQuery })
        .catch(() => null);
      const queryVector = embeddingResult?.embedding ?? [];
      if (queryVector.length === 0) {
        this.logger.warn('Semantic search produced no query embedding');
        return [];
      }

      const hits = await this.vectorStore.search(
        queryVector,
        {
          userId,
          type: MemoryType.LONG_TERM,
          scope: options?.scope,
          tags: options?.tags,
          createdFrom: options?.createdFrom,
          createdTo: options?.createdTo,
        },
        limit
      );

      if (hits.length === 0) {
        return [];
      }

      const ids = hits.map((hit) => hit.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memories = await (this.prisma as any).memory.findMany({
        where: {
          id: { in: ids },
          userId,
          type: MemoryType.LONG_TERM,
        },
      });

      const byId = new Map<string, PrismaMemory>(
        memories.map((memory: PrismaMemory) => [memory.id, memory])
      );

      // Preserve vector-store ranking order and drop hits without a backing row.
      return hits
        .map((hit) => {
          const memory = byId.get(hit.id);
          if (!memory) {
            return null;
          }
          return { memory: this.mapToLtmMemory(memory), score: hit.score };
        })
        .filter((result): result is SemanticSearchResult => result !== null);
    } catch (error) {
      this.logger.error(`Semantic search failed for user ${userId}: ${error}`);
      throw new LtmDatabaseError(
        'semanticSearch',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Backfill / reindex the vector store from Postgres.
   *
   * Pages through long-term memories using a stable cursor, (re)generates
   * embeddings as needed, and upserts them into the configured vector store.
   * The operation is idempotent and cursor-resumable: re-running it is safe and
   * picks up where a prior run stopped when a cursor is supplied. Postgres
   * remains the source of truth, so per-item failures are counted and skipped
   * rather than aborting the whole run.
   */
  async reindex(options: ReindexOptions = {}): Promise<ReindexResult> {
    if (!this.vectorStore) {
      this.logger.warn('Reindex requested but no vector store is configured');
      return { processed: 0, indexed: 0, skipped: 0, failed: 0, cursor: null };
    }

    const batchSize = this.normalizeBatchSize(options.batchSize);
    const reuseExisting = options.reuseExistingEmbeddings ?? true;
    const maxMemories = options.maxMemories;

    let cursor = options.cursor;
    let processed = 0;
    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    let exhausted = false;

    try {
      for (;;) {
        const take =
          maxMemories !== undefined ? Math.min(batchSize, maxMemories - processed) : batchSize;
        if (take <= 0) {
          break;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batch: PrismaMemory[] = await (this.prisma as any).memory.findMany({
          where: {
            type: MemoryType.LONG_TERM,
            ...(options.userId ? { userId: options.userId } : {}),
          },
          orderBy: { id: 'asc' },
          take,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (batch.length === 0) {
          break;
        }

        for (const row of batch) {
          processed += 1;
          const memory = this.mapToLtmMemory(row);
          try {
            const embedding = await this.resolveEmbedding(memory, reuseExisting);
            if (embedding.length === 0) {
              skipped += 1;
              continue;
            }
            await this.vectorStore.upsert([
              {
                id: memory.id,
                vector: embedding,
                payload: this.buildPayload(memory),
              },
            ]);
            indexed += 1;
          } catch (error) {
            failed += 1;
            this.logger.warn(`Reindex failed for memory ${memory.id}: ${error}`);
          }
        }

        const lastRow = batch[batch.length - 1];
        cursor = lastRow ? lastRow.id : cursor;

        options.onProgress?.({ processed, indexed, skipped, failed, cursor: cursor ?? null });

        if (batch.length < take) {
          exhausted = true;
          break;
        }
      }

      this.logger.log(
        `Reindex complete: processed=${processed} indexed=${indexed} skipped=${skipped} failed=${failed}`
      );
      const resumableCursor = exhausted ? null : (cursor ?? null);
      return { processed, indexed, skipped, failed, cursor: resumableCursor };
    } catch (error) {
      this.logger.error(`Reindex aborted: ${error}`);
      throw new LtmDatabaseError('reindex', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Resolve the embedding to index for a memory, reusing the stored embedding
   * when present and permitted, otherwise regenerating via the embeddings
   * service. Returns an empty array when no embedding can be produced.
   */
  private async resolveEmbedding(memory: LtmMemory, reuseExisting: boolean): Promise<number[]> {
    if (reuseExisting && memory.embedding && memory.embedding.length > 0) {
      return memory.embedding;
    }
    if (!this.embeddingsService) {
      return memory.embedding ?? [];
    }
    const result = await this.embeddingsService
      .generate({ text: memory.content })
      .catch(() => null);
    return result?.embedding ?? memory.embedding ?? [];
  }

  /**
   * Clamp the reindex batch size to a sane range.
   */
  private normalizeBatchSize(batchSize?: number): number {
    if (!batchSize || !Number.isInteger(batchSize) || batchSize <= 0) {
      return 100;
    }
    return Math.min(batchSize, 1000);
  }

  /**
   * Upsert a memory's embedding into the vector store. Non-fatal: failures are
   * logged and swallowed so Postgres remains the source of truth.
   */
  private async indexVector(memory: LtmMemory, embedding: number[]): Promise<void> {
    if (!this.vectorStore || embedding.length === 0) {
      return;
    }
    try {
      await this.vectorStore.upsert([
        {
          id: memory.id,
          vector: embedding,
          payload: this.buildPayload(memory),
        },
      ]);
    } catch (error) {
      this.logger.warn(`Failed to index memory ${memory.id} in vector store: ${error}`);
    }
  }

  /**
   * Remove memories from the vector store. Non-fatal.
   */
  private async removeVector(ids: string[]): Promise<void> {
    if (!this.vectorStore || ids.length === 0) {
      return;
    }
    try {
      await this.vectorStore.delete(ids);
    } catch (error) {
      this.logger.warn(`Failed to remove ${ids.length} vector(s) from vector store: ${error}`);
    }
  }

  /**
   * Build the filterable payload stored alongside a memory's vector.
   */
  private buildPayload(memory: LtmMemory): VectorPayload {
    const payload: VectorPayload = {
      userId: memory.userId,
      type: MemoryType.LONG_TERM,
      tags: memory.tags ?? [],
      createdAt: memory.createdAt.getTime(),
    };
    const scope = this.extractScope(memory.metadata);
    if (scope) {
      payload.scope = scope;
    }
    return payload;
  }

  /**
   * Derive an optional `scope` namespace from a memory's metadata.
   */
  private extractScope(metadata: Record<string, unknown> | null | undefined): string | undefined {
    const scope = metadata?.scope;
    return typeof scope === 'string' && scope.length > 0 ? scope : undefined;
  }

  /**
   * Map Prisma Memory to LtmMemory type
   */
  private mapToLtmMemory(memory: PrismaMemory): LtmMemory {
    return {
      ...memory,
      type: 'long-term' as const,
      expiresAt: null,
      metadata: memory.metadata as Record<string, unknown> | null,
      embedding: memory.embedding ?? [],
    };
  }
}
