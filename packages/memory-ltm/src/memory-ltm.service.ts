import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import { MemoryType, PaginatedResult } from '@engram/database';
import { MemoryStmService } from '@engram/memory-stm';
import { EmbeddingsService } from '@engram/embeddings';
import { VECTOR_STORE_TOKEN, type VectorStore, type VectorPayload } from '@engram/vector-store';
import { rankResults, DEFAULT_RANKING_WEIGHTS, type RankingWeights } from './rank';
import { ImportanceScoringService } from './importance.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ContradictionDetectionService } from './contradiction-detection.service';
import { IngestPipelineService } from './ingest/ingest-pipeline.service.js';
import { buildIngestContext } from './ingest/types.js';
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
  DecayPolicyOptions,
  DecayPolicyResult,
  DuplicateDetectionMatch,
  ContradictionMatch,
  ContradictionCandidate,
  validateCreateLtmMemory,
  validateUpdateLtmMemory,
  validateLtmQueryOptions,
} from './types';

// Type for Prisma Memory result - temporary until Prisma types are properly configured
type PrismaMemory = {
  id: string;
  userId: string;
  organizationId: string | null;
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
    private readonly vectorStore?: VectorStore,
    @Optional() private readonly importanceService?: ImportanceScoringService,
    @Optional() private readonly duplicateDetectionService?: DuplicateDetectionService,
    @Optional() private readonly ingestPipeline?: IngestPipelineService,
    @Optional() private readonly contradictionDetectionService?: ContradictionDetectionService
  ) {
    this.config = { ...DEFAULT_LTM_CONFIG };
    // Use prisma to avoid unused variable warning
    // TODO: Remove this workaround once Prisma types are properly configured and the actual implementation uses `this.prisma`
    void this.prisma;
  }

  /**
   * Create a new long-term memory.
   *
   * Runs the B0 ingest pipeline (steps 1–6) before write, then handles
   * steps 7 (PostgresWrite), 11 (EmbeddingGenerate), and 12 (SearchIndexUpdate)
   * inline.  Steps 8–10 and 13 fire asynchronously after a successful write.
   */
  async create(input: CreateLtmMemoryData): Promise<LtmMemory> {
    this.logger.debug(`Creating LTM memory for user: ${input.userId}`);

    // Validate input
    const validatedInput = validateCreateLtmMemory(input);

    try {
      // Check if user has exceeded quota
      await this.checkQuota(validatedInput.userId);

      // ── Steps 1–6: pre-write pipeline ────────────────────────────────────
      // Runs PrivacyFilter (1), ContentHashDedup (2), TopicDetector (4).
      // Steps 3, 5, 6 are applied inline / as no-ops here.
      let ingestCtx = buildIngestContext({
        userId: validatedInput.userId,
        organizationId: validatedInput.organizationId,
        content: validatedInput.content,
        tags: validatedInput.tags,
        metadata: validatedInput.metadata,
      });

      if (this.ingestPipeline) {
        ingestCtx = await this.ingestPipeline.runSyncSteps(ingestCtx);
      }

      const processedContent = ingestCtx.content;
      const processedTags = ingestCtx.tags;
      const processedMetadata = ingestCtx.metadata;

      // Step 2 (exact): return the existing memory when the privacy-filtered
      // content matches exactly — avoids the embedding cost and vector dedup path.
      const exactDup = await this.findExactDuplicate(
        validatedInput.userId,
        processedContent,
        validatedInput.organizationId
      );
      if (exactDup) {
        this.logger.debug(`Exact content duplicate; returning existing memory ${exactDup.id}`);
        return this.mapToLtmMemory(exactDup);
      }

      // ── Step 11: EmbeddingGenerate (non-fatal) ─────────────────────────
      let embedding: number[] = [];
      if (this.embeddingsService) {
        const result = await this.embeddingsService
          .generate({ text: processedContent })
          .catch(() => null);
        embedding = result?.embedding ?? [];
      }

      // ── Step 2 (vector): semantic duplicate detection ──────────────────
      const duplicate =
        !input.skipDuplicateCheck &&
        (await this.findDuplicate(validatedInput.userId, validatedInput.organizationId, embedding));
      if (duplicate) {
        return await this.linkDuplicateAndReturn(
          duplicate.memoryId,
          validatedInput.userId,
          validatedInput.organizationId,
          duplicate.score,
          processedContent
        );
      }

      // ── Step B1: contradiction detection ──────────────────────────────
      const contradiction = await this.findContradictionCandidate(
        validatedInput.userId,
        validatedInput.organizationId,
        processedContent,
        embedding
      );

      // ── Step 5: ImportanceScorer (inline annotation) ───────────────────
      let contradictionAnnotatedMeta = processedMetadata;
      if (contradiction) {
        const existingRow = await this.findRawMemory(
          validatedInput.userId,
          contradiction.memoryId,
          validatedInput.organizationId
        );
        if (existingRow) {
          contradictionAnnotatedMeta = this.contradictionDetectionService!.annotateContradictor(
            processedMetadata,
            contradiction,
            existingRow.content.slice(0, 120)
          );
        }
      }

      const metadata = this.annotateImportance(contradictionAnnotatedMeta, {
        content: processedContent,
        metadata: contradictionAnnotatedMeta,
        tags: processedTags,
        accessCount: 0,
      });

      // ── Step 7: PostgresWrite ──────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memory = await (this.prisma as any).memory.create({
        data: {
          userId: validatedInput.userId,
          organizationId: validatedInput.organizationId ?? null,
          content: processedContent,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          metadata: metadata as any,
          tags: processedTags,
          type: MemoryType.LONG_TERM,
          expiresAt: null,
          embedding,
        },
      });

      this.logger.debug(`LTM memory created: ${memory.id}`);
      const ltmMemory = this.mapToLtmMemory(memory);

      // ── Step B1 (post-write): mark superseded memory (non-fatal) ───────
      if (contradiction) {
        await this.markSuperseded(
          contradiction.memoryId,
          ltmMemory.id,
          contradiction.reason,
          validatedInput.userId,
          validatedInput.organizationId
        ).catch((err: unknown) =>
          this.logger.warn(
            `Failed to mark memory ${contradiction.memoryId} as superseded: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }

      // ── Step 12: SearchIndexUpdate (non-fatal) ─────────────────────────
      await this.indexVector(ltmMemory, embedding);

      // ── Steps 8–10, 13: async hooks (fire-and-forget) ─────────────────
      if (this.ingestPipeline) {
        this.ingestPipeline.runAsyncHooks(ingestCtx, ltmMemory.id);
      }

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
   * Retrieve a long-term memory by ID.
   *
   * When `organizationId` is provided the query is narrowed to that org's rows,
   * preventing cross-tenant access. Omitting it is permitted for admin / system
   * callers (e.g. reindex) but must NOT be used in user-facing paths — the auth
   * layer (#128, #130) must always supply the caller's org context.
   */
  async get(userId: string, memoryId: string, organizationId?: string): Promise<LtmMemory | null> {
    this.logger.debug(`Getting LTM memory: ${memoryId} for user: ${userId}`);

    try {
      const where: Record<string, unknown> = {
        id: memoryId,
        userId: userId,
        type: MemoryType.LONG_TERM,
      };
      if (organizationId !== undefined) {
        where.organizationId = organizationId;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memory = await (this.prisma as any).memory.findFirst({ where });

      if (!memory) {
        return null;
      }
      const ltmMemory = this.mapToLtmMemory(memory);
      void this.recordAccess(ltmMemory);
      return ltmMemory;
    } catch (error) {
      this.logger.error(`Failed to get LTM memory ${memoryId}: ${error}`);
      throw new LtmDatabaseError('get', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Update a long-term memory.
   * Pass `organizationId` in user-facing paths to prevent cross-tenant writes.
   * See `get()` for the full isolation contract.
   */
  async update(
    userId: string,
    memoryId: string,
    input: UpdateLtmMemoryData,
    organizationId?: string
  ): Promise<LtmMemory> {
    this.logger.debug(`Updating LTM memory: ${memoryId} for user: ${userId}`);

    // Validate input
    const validatedInput = validateUpdateLtmMemory(input);

    try {
      const existingRow = await this.findRawMemory(userId, memoryId, organizationId);
      if (!existingRow) {
        throw new LtmMemoryNotFoundError(memoryId);
      }
      const existing = this.mapToLtmMemory(existingRow);

      // Prepare update data (only include fields that are provided)
      const updateData: Record<string, unknown> = {};

      if (validatedInput.content !== undefined) {
        updateData.content = validatedInput.content;
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

      // Resolve final metadata: full-replace wins over patch; patch merges into existing.
      const nextMetadata: Record<string, unknown> | null =
        validatedInput.metadata !== undefined
          ? (validatedInput.metadata ?? null)
          : validatedInput.metadataMerge !== undefined
            ? { ...(existing.metadata ?? {}), ...validatedInput.metadataMerge }
            : (existing.metadata ?? null);

      const nextContent = validatedInput.content ?? existing.content;
      const nextTags = validatedInput.tags ?? existing.tags;
      updateData.metadata = this.annotateImportance(nextMetadata, {
        content: nextContent,
        metadata: nextMetadata,
        tags: nextTags,
        accessCount: this.readAccessCount(nextMetadata),
        pinned: this.readPinned(nextMetadata),
        createdAt: existing.createdAt,
        lastAccessedAt: this.readLastAccessedAt(nextMetadata),
      });
      if (validatedInput.tags !== undefined) {
        updateData.tags = validatedInput.tags || [];
      }

      // Build the where clause; Prisma requires a unique filter for update.
      // We enforce org scope via the prior get() call and pass it here too so
      // a concurrent row move cannot be exploited between the two queries.
      const updateWhere: Record<string, unknown> = {
        id: memoryId,
        userId: userId,
        type: MemoryType.LONG_TERM,
      };
      if (organizationId !== undefined) {
        updateWhere.organizationId = organizationId;
      }

      // Update memory in database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memory = await (this.prisma as any).memory.update({
        where: updateWhere,
        data: updateData,
      });

      this.logger.debug(`LTM memory updated: ${memoryId}`);
      const ltmMemory = this.mapToLtmMemory(memory);

      // Re-index on new embedding, tag changes, or metadata changes that alter the
      // scope field (the only metadata value persisted in the vector payload).
      const oldScope = this.extractScope(existing.metadata);
      const newScope = this.extractScope(nextMetadata);
      const metadataAffectsPayload =
        (validatedInput.metadata !== undefined || validatedInput.metadataMerge !== undefined) &&
        oldScope !== newScope;
      const embeddingToIndex = newEmbedding ?? ltmMemory.embedding;
      if (
        embeddingToIndex.length > 0 &&
        (newEmbedding !== undefined || validatedInput.tags !== undefined || metadataAffectsPayload)
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
   * Delete a long-term memory.
   * Pass `organizationId` in user-facing paths to prevent cross-tenant deletes.
   * See `get()` for the full isolation contract.
   */
  async delete(userId: string, memoryId: string, organizationId?: string): Promise<boolean> {
    this.logger.debug(`Deleting LTM memory: ${memoryId} for user: ${userId}`);

    try {
      const deleteWhere: Record<string, unknown> = {
        id: memoryId,
        userId: userId,
        type: MemoryType.LONG_TERM,
      };
      if (organizationId !== undefined) {
        deleteWhere.organizationId = organizationId;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.prisma as any).memory.deleteMany({ where: deleteWhere });

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

      if (validatedOptions.organizationId) {
        whereClause.organizationId = validatedOptions.organizationId;
      }

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

      if (filters?.organizationId) {
        whereClause.organizationId = filters.organizationId;
      }

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
   * Promote a memory from short-term to long-term storage.
   * Pass `organizationId` to preserve the org scope through the STM→LTM transfer.
   */
  async promote(userId: string, memoryId: string, organizationId?: string): Promise<LtmMemory> {
    this.logger.debug(`Promoting memory ${memoryId} to LTM for user: ${userId}`);

    if (!this.stmService) {
      throw new LtmPromotionError(memoryId, 'STM service not available for promotion');
    }

    try {
      // Step 1: Get memory from STM service (org-scoped so we find the right key)
      const stmMemory = await this.stmService.findById(userId, memoryId, organizationId);
      if (!stmMemory) {
        throw new LtmPromotionError(memoryId, 'Memory not found in short-term storage');
      }

      // Step 2: Pre-check quota to avoid a needless embeddings API call when over quota.
      await this.checkQuota(userId);

      // Org scope: prefer the explicit param, fall back to what's stored in the STM payload.
      const resolvedOrgId = organizationId ?? stmMemory.organizationId ?? null;

      // Exact content dedup: if the STM content already exists verbatim in LTM,
      // skip promotion and return the existing memory without generating an embedding.
      const exactDup = await this.findExactDuplicate(userId, stmMemory.content, resolvedOrgId);
      if (exactDup) {
        this.logger.debug(
          `Exact content duplicate on promote; returning existing LTM memory ${exactDup.id}`
        );
        try {
          await this.stmService.delete(
            userId,
            memoryId,
            organizationId ?? stmMemory.organizationId
          );
        } catch (stmDeleteError) {
          this.logger.warn(
            `Failed to delete STM memory ${memoryId} after exact duplicate on promote: ${stmDeleteError}`
          );
        }
        return this.mapToLtmMemory(exactDup);
      }

      // Step 3: Generate embedding before the transaction (I/O outside DB tx).
      let embedding: number[] = [];
      if (this.embeddingsService) {
        const result = await this.embeddingsService
          .generate({ text: stmMemory.content })
          .catch(() => null);
        embedding = result?.embedding ?? [];
      }

      const duplicate = await this.findDuplicate(userId, resolvedOrgId ?? undefined, embedding);
      if (duplicate) {
        const existing = await this.linkDuplicateAndReturn(
          duplicate.memoryId,
          userId,
          resolvedOrgId ?? undefined,
          duplicate.score,
          stmMemory.content
        );
        try {
          await this.stmService.delete(
            userId,
            memoryId,
            organizationId ?? stmMemory.organizationId
          );
        } catch (stmDeleteError) {
          this.logger.warn(
            `Failed to delete STM memory ${memoryId} after duplicate link: ${stmDeleteError}`
          );
        }
        return existing;
      }

      const metadata = this.annotateImportance(stmMemory.metadata, {
        content: stmMemory.content,
        metadata: stmMemory.metadata,
        tags: stmMemory.tags,
        accessCount: stmMemory.accessCount ?? 0,
        createdAt: stmMemory.createdAt,
        lastAccessedAt: stmMemory.updatedAt,
      });

      // Step 4: Begin database transaction for atomic operation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.prisma as any).$transaction(async (prisma: any) => {
        // Re-check quota inside transaction to guard against races.
        await this.checkQuota(userId);

        // Create memory in LTM, preserving the org scope from STM.
        return await prisma.memory.create({
          data: {
            id: stmMemory.id,
            userId: stmMemory.userId,
            organizationId: resolvedOrgId,
            content: stmMemory.content,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            metadata: metadata as any,
            tags: stmMemory.tags,
            type: MemoryType.LONG_TERM,
            createdAt: stmMemory.createdAt,
            updatedAt: new Date(),
            expiresAt: null,
            embedding,
          },
        });
      });

      // Step 5: Delete from STM storage (only after successful LTM creation)
      try {
        await this.stmService.delete(userId, memoryId, organizationId ?? stmMemory.organizationId);
        this.logger.debug(`Successfully promoted memory ${memoryId} from STM to LTM`);
      } catch (stmDeleteError) {
        // Log warning but don't fail the operation since LTM creation succeeded
        this.logger.warn(
          `Failed to delete STM memory ${memoryId} after promotion: ${stmDeleteError}`
        );
      }

      const ltmMemory = this.mapToLtmMemory(result);

      // Step 6: Mirror embedding into vector store (non-fatal).
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
    // Over-fetch so re-ranking has enough candidates; cap to avoid overwhelming the store.
    const fetchLimit = Math.min(limit * 3, 100);

    const rw = options?.rankingWeights;
    const weights: RankingWeights = {
      similarity: rw?.similarity ?? DEFAULT_RANKING_WEIGHTS.similarity,
      recency: rw?.recency ?? DEFAULT_RANKING_WEIGHTS.recency,
      importance: rw?.importance ?? DEFAULT_RANKING_WEIGHTS.importance,
    };
    const rawHalfLife = options?.recencyHalfLifeDays;
    const halfLifeDays =
      typeof rawHalfLife === 'number' && Number.isFinite(rawHalfLife) && rawHalfLife > 0
        ? rawHalfLife
        : 30;

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
          organizationId: options?.organizationId,
          type: MemoryType.LONG_TERM,
          scope: options?.scope,
          tags: options?.tags,
          createdFrom: options?.createdFrom,
          createdTo: options?.createdTo,
        },
        fetchLimit
      );

      if (hits.length === 0) {
        return [];
      }

      const ids = hits.map((hit: { id: string }) => hit.id);
      const memWhere: Record<string, unknown> = {
        id: { in: ids },
        userId,
        type: MemoryType.LONG_TERM,
      };
      if (options?.organizationId) {
        memWhere.organizationId = options.organizationId;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memories = await (this.prisma as any).memory.findMany({ where: memWhere });

      const byId = new Map<string, PrismaMemory>(
        memories.map((memory: PrismaMemory) => [memory.id, memory])
      );

      const hydrated = hits
        .map((hit: { id: string; score: number }) => {
          const memory = byId.get(hit.id);
          if (!memory) {
            return null;
          }
          return { memory: this.mapToLtmMemory(memory), score: hit.score };
        })
        .filter(
          (result: SemanticSearchResult | null): result is SemanticSearchResult => result !== null
        );

      // Re-rank by blended similarity + recency + importance, then trim to requested limit.
      const ranked = rankResults(hydrated, weights, halfLifeDays).slice(0, limit);
      void this.recordAccessMany(ranked.map((result) => result.memory));
      return ranked;
    } catch (error) {
      this.logger.error(`Semantic search failed for user ${userId}: ${error}`);
      throw new LtmDatabaseError(
        'semanticSearch',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Return LTM memories that carry a given topic tag, are not yet attributed
   * to an insight (no `insightId` in metadata), and are not insight memories
   * themselves (not tagged `insight`).  Used by the insight extraction job.
   */
  async findInsightCandidates(topic: string, limit: number, userId?: string): Promise<LtmMemory[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: PrismaMemory[] = await (this.prisma as any).memory.findMany({
      where: {
        type: MemoryType.LONG_TERM,
        tags: { hasSome: [topic] },
        NOT: { tags: { hasSome: ['insight', 'clustered'] } },
        ...(userId ? { userId } : {}),
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => this.mapToLtmMemory(row));
  }

  async applyDecayPolicy(options: DecayPolicyOptions = {}): Promise<DecayPolicyResult> {
    const batchSize = this.normalizeBatchSize(options.batchSize);
    const staleScoreThreshold = this.normalizeThreshold(options.staleScoreThreshold, 0.3);
    const pruneScoreThreshold = this.normalizeThreshold(options.pruneScoreThreshold, 0.15);
    const pruneOlderThanDays =
      typeof options.pruneOlderThanDays === 'number' && options.pruneOlderThanDays >= 0
        ? options.pruneOlderThanDays
        : 30;

    let cursor = options.cursor;
    let processed = 0;
    let updated = 0;
    let pruned = 0;
    let stale = 0;
    let exhausted = false;

    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batch: PrismaMemory[] = await (this.prisma as any).memory.findMany({
        where: {
          type: MemoryType.LONG_TERM,
          ...(options.userId ? { userId: options.userId } : {}),
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) {
        break;
      }

      for (const row of batch) {
        processed += 1;
        const memory = this.mapToLtmMemory(row);
        const metadata = this.normalizeMetadata(memory.metadata);
        const nextMetadata = this.annotateImportance(metadata, {
          content: memory.content,
          metadata,
          tags: memory.tags,
          accessCount: this.readAccessCount(metadata),
          pinned: this.readPinned(metadata),
          createdAt: memory.createdAt,
          lastAccessedAt: this.readLastAccessedAt(metadata),
        });
        const score = this.readImportance(nextMetadata);
        const ageDays = this.ageDays(memory.createdAt);
        const status =
          typeof nextMetadata['status'] === 'string' ? nextMetadata['status'] : 'active';
        if (status !== 'active' || score < staleScoreThreshold) {
          stale += 1;
        }

        if (
          score < pruneScoreThreshold &&
          ageDays >= pruneOlderThanDays &&
          !this.readPinned(nextMetadata)
        ) {
          if (options.dryRun) {
            pruned += 1;
            continue;
          }
          try {
            await this.delete(memory.userId, memory.id, memory.organizationId ?? undefined);
            pruned += 1;
          } catch (error) {
            this.logger.warn(`Decay prune failed for memory ${memory.id}: ${String(error)}`);
          }
          continue;
        }

        const oldStatus = typeof metadata['status'] === 'string' ? metadata['status'] : 'active';
        const oldImportance = this.readImportance(metadata);
        if (oldStatus !== status || Math.abs(oldImportance - score) > 0.01) {
          if (options.dryRun) {
            updated += 1;
            continue;
          }
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (this.prisma as any).memory.update({
              where: { id: memory.id },
              data: { metadata: nextMetadata },
            });
            updated += 1;
          } catch (error) {
            this.logger.warn(
              `Decay metadata update failed for memory ${memory.id}: ${String(error)}`
            );
          }
        }
      }

      const lastRow = batch[batch.length - 1];
      cursor = lastRow?.id ?? cursor;
      if (batch.length < batchSize) {
        exhausted = true;
        break;
      }
    }

    return { processed, updated, pruned, stale, cursor: exhausted ? null : (cursor ?? null) };
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

  private normalizeThreshold(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
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

  private async findRawMemory(
    userId: string,
    memoryId: string,
    organizationId?: string
  ): Promise<PrismaMemory | null> {
    const where: Record<string, unknown> = {
      id: memoryId,
      userId,
      type: MemoryType.LONG_TERM,
    };
    if (organizationId !== undefined) {
      where.organizationId = organizationId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).memory.findFirst({ where }) as Promise<PrismaMemory | null>;
  }

  private normalizeMetadata(
    metadata: Record<string, unknown> | null | undefined
  ): Record<string, unknown> {
    return { ...(metadata ?? {}) };
  }

  private annotateImportance(
    metadata: Record<string, unknown> | null | undefined,
    signals: {
      content: string;
      metadata?: Record<string, unknown> | null;
      tags?: string[];
      accessCount?: number;
      pinned?: boolean;
      createdAt?: Date;
      lastAccessedAt?: Date | string | null;
    }
  ): Record<string, unknown> {
    if (!this.importanceService) {
      return this.normalizeMetadata(metadata);
    }
    return this.importanceService.annotateMetadata(metadata, signals);
  }

  private readAccessCount(metadata: Record<string, unknown> | null | undefined): number {
    return typeof metadata?.['accessCount'] === 'number' && Number.isFinite(metadata['accessCount'])
      ? (metadata['accessCount'] as number)
      : 0;
  }

  private readPinned(metadata: Record<string, unknown> | null | undefined): boolean {
    return metadata?.['pinned'] === true;
  }

  private readLastAccessedAt(metadata: Record<string, unknown> | null | undefined): Date | null {
    const raw = metadata?.['lastAccessedAt'];
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      return raw;
    }
    if (typeof raw === 'string') {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private readImportance(metadata: Record<string, unknown> | null | undefined): number {
    const importance = metadata?.['importance'];
    return typeof importance === 'number' && Number.isFinite(importance) ? importance : 0.5;
  }

  private ageDays(date: Date): number {
    return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
  }

  private async findExactDuplicate(
    userId: string,
    content: string,
    organizationId: string | null | undefined
  ): Promise<PrismaMemory | null> {
    const where: Record<string, unknown> = {
      userId,
      content,
      type: MemoryType.LONG_TERM,
    };
    if (organizationId !== undefined) {
      where.organizationId = organizationId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).memory.findFirst({ where }) as Promise<PrismaMemory | null>;
  }

  private async findDuplicate(
    userId: string,
    organizationId: string | undefined,
    embedding: number[]
  ): Promise<DuplicateDetectionMatch | null> {
    if (!this.vectorStore || !this.duplicateDetectionService || embedding.length === 0) {
      return null;
    }
    const hits = await this.vectorStore.search(
      embedding,
      { userId, organizationId, type: MemoryType.LONG_TERM },
      3
    );
    return this.duplicateDetectionService.findMatch(hits);
  }

  private async findContradictionCandidate(
    userId: string,
    organizationId: string | undefined,
    content: string,
    embedding: number[]
  ): Promise<ContradictionMatch | null> {
    if (!this.vectorStore || !this.contradictionDetectionService || embedding.length === 0) {
      return null;
    }
    const hits = await this.vectorStore.search(
      embedding,
      { userId, organizationId, type: MemoryType.LONG_TERM },
      5
    );
    if (hits.length === 0) return null;

    // Fetch content for all hit candidates in one query, scoped to the same
    // tenant so a vector-store misconfiguration cannot surface foreign rows.
    const hitIds = hits.map((h) => h.id);
    const contentWhere: Record<string, unknown> = {
      id: { in: hitIds },
      userId,
      type: MemoryType.LONG_TERM,
    };
    if (organizationId !== undefined) {
      contentWhere.organizationId = organizationId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: { id: string; content: string }[] = await (this.prisma as any).memory.findMany({
      where: contentWhere,
      select: { id: true, content: true },
    });
    const contentMap = new Map(rows.map((r) => [r.id, r.content]));

    const candidates: ContradictionCandidate[] = hits
      .filter((h) => contentMap.has(h.id))
      .map((h) => ({ id: h.id, score: h.score, content: contentMap.get(h.id)! }));

    return this.contradictionDetectionService.detect(content, candidates);
  }

  private async markSuperseded(
    memoryId: string,
    supersededById: string,
    reason: string,
    userId: string,
    organizationId: string | undefined
  ): Promise<void> {
    const existing = await this.findRawMemory(userId, memoryId, organizationId);
    if (!existing) return;
    const updatedMeta = this.contradictionDetectionService!.annotateSuperseded(
      existing.metadata as Record<string, unknown> | null,
      supersededById,
      reason
    );
    const updateWhere: Record<string, unknown> = {
      id: memoryId,
      userId,
      type: MemoryType.LONG_TERM,
    };
    if (organizationId !== undefined) {
      updateWhere.organizationId = organizationId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.prisma as any).memory.update({
      where: updateWhere,
      data: { metadata: updatedMeta },
    });
    this.logger.debug(`Memory ${memoryId} marked superseded by ${supersededById}`);
  }

  private async linkDuplicateAndReturn(
    memoryId: string,
    userId: string,
    organizationId: string | undefined,
    score: number,
    content: string
  ): Promise<LtmMemory> {
    const existing = await this.findRawMemory(userId, memoryId, organizationId);
    if (!existing) {
      throw new LtmMemoryNotFoundError(memoryId);
    }
    const existingMemory = this.mapToLtmMemory(existing);
    const match: DuplicateDetectionMatch = { memoryId, score };
    // duplicateDetectionService is guaranteed non-null here: findDuplicate() returns null
    // when it is absent, and linkDuplicateAndReturn is only called on a non-null result.
    const metadataWithDuplicate = this.duplicateDetectionService!.annotateMetadata(
      existingMemory.metadata,
      match,
      content.slice(0, 120)
    );
    const metadata = this.annotateImportance(metadataWithDuplicate, {
      content: existingMemory.content,
      metadata: metadataWithDuplicate,
      tags: existingMemory.tags,
      accessCount: this.readAccessCount(existingMemory.metadata),
      pinned: this.readPinned(existingMemory.metadata),
      createdAt: existingMemory.createdAt,
      lastAccessedAt: this.readLastAccessedAt(existingMemory.metadata),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (this.prisma as any).memory.update({
      where: { id: existingMemory.id },
      data: { metadata },
    });
    return this.mapToLtmMemory(updated);
  }

  private async recordAccess(memory: LtmMemory): Promise<void> {
    if (!this.importanceService) {
      return;
    }
    try {
      const accessCount = this.readAccessCount(memory.metadata) + 1;
      const metadata = this.annotateImportance(memory.metadata, {
        content: memory.content,
        metadata: memory.metadata,
        tags: memory.tags,
        accessCount,
        pinned: this.readPinned(memory.metadata),
        createdAt: memory.createdAt,
        lastAccessedAt: new Date(),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.prisma as any).memory.update({
        where: { id: memory.id },
        data: { metadata },
      });
    } catch (error) {
      this.logger.warn(`Failed to record access for memory ${memory.id}: ${error}`);
    }
  }

  private async recordAccessMany(memories: LtmMemory[]): Promise<void> {
    const unique = new Map(memories.map((memory) => [memory.id, memory]));
    await Promise.all([...unique.values()].map((memory) => this.recordAccess(memory)));
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
    if (memory.organizationId) {
      payload.organizationId = memory.organizationId;
    }
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
      organizationId: memory.organizationId ?? undefined,
      type: 'long-term' as const,
      expiresAt: null,
      metadata: memory.metadata as Record<string, unknown> | null,
      embedding: memory.embedding ?? [],
    };
  }
}
