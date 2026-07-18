import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import { MemoryType, PaginatedResult } from '@engram/database';
import { MemoryStmService } from '@engram/memory-stm';
import { EmbeddingsService } from '@engram/embeddings';
import {
  VECTOR_STORE_TOKEN,
  type VectorStore,
  type VectorPayload,
  type VectorSearchResult,
} from '@engram/vector-store';
import { rankResults, DEFAULT_RANKING_WEIGHTS, type RankingWeights } from './rank';
import { ImportanceScoringService } from './importance.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ContradictionDetectionService } from './contradiction-detection.service';
import { IngestPipelineService } from './ingest/ingest-pipeline.service.js';
import { buildIngestContext } from './ingest/types.js';
import { HybridTransientRetriever } from './retrieval/hybrid-transient-retriever.js';
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
  LtmVersionConflictError,
  LtmEmbeddingUnavailableError,
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

/**
 * Advisory-lock namespace for per-user LTM quota serialization (first int of
 * the two-int `pg_advisory_xact_lock` key; the second is `hashtext(userId)`).
 * The value is arbitrary ("ENGR" as int32) but MUST stay stable across
 * releases so every writer — including older deployments during a rolling
 * upgrade — serializes on the same lock.
 */
export const LTM_QUOTA_LOCK_NAMESPACE = 0x454e4752;

// Type for Prisma Memory result - temporary until Prisma types are properly configured
type PrismaMemory = {
  id: string;
  userId: string;
  organizationId: string | null;
  scope: string | null;
  content: string;
  metadata: unknown; // Using unknown for type safety; must be type-checked before use
  tags: string[];
  type: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  embedding: number[];
};

// Input shape for an LTM row insert: mirrors PrismaMemory but with the
// server-defaulted columns (id/createdAt/updatedAt/version) optional. Keeps the
// single insert choke point (createRowWithQuota) strongly typed against callers.
type LtmMemoryCreateData = Omit<PrismaMemory, 'id' | 'createdAt' | 'updatedAt' | 'version'> &
  Partial<Pick<PrismaMemory, 'id' | 'createdAt' | 'updatedAt' | 'version'>>;

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
    @Optional() private readonly contradictionDetectionService?: ContradictionDetectionService,
    @Optional() private readonly transientRetriever?: HybridTransientRetriever
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
      // Fast-fail pre-check only: avoids the embedding/dedup cost when the
      // user is already over quota. The authoritative, race-free check runs
      // inside createRowWithQuota() below.
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
        validatedInput.organizationId,
        validatedInput.scope
      );
      if (exactDup) {
        this.logger.debug(`Exact content duplicate; returning existing memory ${exactDup.id}`);
        return this.mapToLtmMemory(exactDup);
      }

      // ── Step 11: EmbeddingGenerate (non-fatal) ─────────────────────────
      // Skip embedding entirely for an `embeddingExcluded` memory (e.g. an
      // import secret-scan `flag`): the row is stored with an empty vector and
      // never reaches the embedding provider, until a reindex re-includes it.
      let embedding: number[] = [];
      if (this.embeddingsService && !this.readEmbeddingExcluded(processedMetadata)) {
        const result = await this.embeddingsService
          .generate({ text: processedContent })
          .catch(() => null);
        embedding = result?.embedding ?? [];
      }

      // ── Step 2 (vector): semantic duplicate detection ──────────────────
      // Scope is passed so dedup stays within the create's namespace — an
      // unscoped write must never collapse into a scoped memory, or vice-versa.
      const duplicate =
        !input.skipDuplicateCheck &&
        (await this.findDuplicate(
          validatedInput.userId,
          validatedInput.organizationId,
          validatedInput.scope,
          embedding
        ));
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
      // Scope-bound so a write can only supersede memories in its own namespace.
      const contradiction = await this.findContradictionCandidate(
        validatedInput.userId,
        validatedInput.organizationId,
        validatedInput.scope,
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

      let metadata = this.annotateImportance(contradictionAnnotatedMeta, {
        content: processedContent,
        metadata: contradictionAnnotatedMeta,
        tags: processedTags,
        accessCount: 0,
      });

      // G3-T4 (policy `flag`, the default): the NEW row is also marked
      // `contradicted` with review fields pointing at the existing row.
      // Applied AFTER annotateImportance, which rewrites `status`; the durable
      // marker is `contradictionWith` (see annotateContradicted).
      if (contradiction && contradiction.action === 'flagged') {
        metadata = this.contradictionDetectionService!.annotateContradicted(
          metadata,
          contradiction.memoryId,
          contradiction.reason
        );
      }

      // ── Step 7: PostgresWrite (atomic quota + insert) ──────────────────
      const memory = await this.createRowWithQuota(validatedInput.userId, {
        userId: validatedInput.userId,
        organizationId: validatedInput.organizationId ?? null,
        scope: validatedInput.scope ?? null,
        content: processedContent,
        metadata,
        tags: processedTags,
        type: MemoryType.LONG_TERM,
        expiresAt: null,
        embedding,
      });

      this.logger.debug(`LTM memory created: ${memory.id}`);
      const ltmMemory = this.mapToLtmMemory(memory);

      // ── Step B1 (post-write): apply the contradiction policy (non-fatal) ──
      // `supersede` → latest-wins, the older row is hidden from default recall
      //   (pre-G3-T4 behaviour, unchanged).
      // `flagged` (policy `flag`, the default) → BOTH rows are kept visible:
      //   the existing row gets the `contradicted` review metadata via the
      //   G3-T3 CAS path and the pair is linked with a `contradicts` MemoryLink.
      if (contradiction) {
        if (contradiction.action === 'flagged') {
          await this.markContradicted(
            contradiction.memoryId,
            ltmMemory.id,
            contradiction.reason,
            validatedInput.userId,
            validatedInput.organizationId
          ).catch((err: unknown) =>
            this.logger.warn(
              `Failed to flag memory ${contradiction.memoryId} as contradicted: ${err instanceof Error ? err.message : String(err)}`
            )
          );
          await this.linkContradiction(
            ltmMemory.id,
            contradiction.memoryId,
            contradiction,
            validatedInput.userId,
            validatedInput.organizationId
          ).catch((err: unknown) =>
            this.logger.warn(
              `Failed to link contradicted pair ${ltmMemory.id} ↔ ${contradiction.memoryId}: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        } else {
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
  async get(
    userId: string,
    memoryId: string,
    organizationId?: string,
    scope?: string
  ): Promise<LtmMemory | null> {
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
      if (scope !== undefined) {
        where.scope = scope;
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
    organizationId?: string,
    scope?: string
  ): Promise<LtmMemory> {
    this.logger.debug(`Updating LTM memory: ${memoryId} for user: ${userId}`);

    // Validate input
    const validatedInput = validateUpdateLtmMemory(input);

    try {
      // Pass scope so a caller bound to a namespace cannot update memories
      // outside it — a mismatch resolves to not-found.
      const existingRow = await this.findRawMemory(userId, memoryId, organizationId, scope);
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

      // Resolve final metadata FIRST (full-replace wins over patch; patch merges
      // into existing) so we know whether this memory is embeddingExcluded before
      // deciding whether to (re)embed it — an excluded row (e.g. an import
      // secret-scan `flag`) must never be re-embedded on a content/tag edit.
      let nextMetadata: Record<string, unknown> | null =
        validatedInput.metadata !== undefined
          ? (validatedInput.metadata ?? null)
          : validatedInput.metadataMerge !== undefined
            ? { ...(existing.metadata ?? {}), ...validatedInput.metadataMerge }
            : (existing.metadata ?? null);
      const embeddingExcluded = this.readEmbeddingExcluded(nextMetadata);

      // Re-embed when the content changes so the vector stays consistent with
      // the stored text (non-fatal — falls back to the existing embedding).
      // Skipped entirely for an embeddingExcluded memory.
      let newEmbedding: number[] | undefined;
      if (validatedInput.content !== undefined && this.embeddingsService && !embeddingExcluded) {
        const result = await this.embeddingsService
          .generate({ text: validatedInput.content })
          .catch(() => null);
        if (result?.embedding) {
          newEmbedding = result.embedding;
          updateData.embedding = newEmbedding;
        }
      }

      // Embedding staleness (WP2 T7/A9/D10): a content edit that could NOT be
      // re-embedded (provider down or absent) leaves the OLD vector pointing at
      // the previous text — flag it so recall drift is visible and repairable;
      // clear the flag whenever a fresh embedding is written. Scoped strictly to
      // "embedding column vs content": an indexVector throw below leaves a correct
      // embedding in Postgres (reindex-recoverable) and does NOT set this flag.
      // An embeddingExcluded memory is intentionally out of the index, so it is
      // never marked stale.
      if (validatedInput.content !== undefined && !embeddingExcluded) {
        const meta = { ...(nextMetadata ?? {}) };
        if (newEmbedding === undefined) {
          meta.embeddingStale = true;
        } else {
          delete meta.embeddingStale;
        }
        nextMetadata = meta;
      }

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

      // Optimistic concurrency (WP2 T4/G4): always bump version; when the caller
      // supplied expectedVersion, fold it into the compare-and-swap `where` so a
      // stale writer's update matches no row (Prisma P2025) instead of clobbering.
      updateData.version = { increment: 1 };

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
      if (validatedInput.expectedVersion !== undefined) {
        updateWhere.version = validatedInput.expectedVersion;
      }

      // Update memory in database
      let memory: PrismaMemory;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        memory = await (this.prisma as any).memory.update({
          where: updateWhere,
          data: updateData,
        });
      } catch (updateError) {
        // P2025 = no row matched the where. Either the version moved (conflict)
        // or the row is gone (not-found). Re-fetch without the version filter to
        // tell them apart.
        if ((updateError as { code?: string }).code === 'P2025') {
          const current = await this.findRawMemory(userId, memoryId, organizationId, scope);
          if (current) {
            throw new LtmVersionConflictError(memoryId, current.version);
          }
          throw new LtmMemoryNotFoundError(memoryId);
        }
        throw updateError;
      }

      this.logger.debug(`LTM memory updated: ${memoryId}`);
      const ltmMemory = this.mapToLtmMemory(memory);

      // Re-index when the embedding or tags change (both affect the stored vector payload).
      // Scope is immutable via update(), so it never triggers a re-index here.
      const embeddingToIndex = newEmbedding ?? ltmMemory.embedding;
      if (
        !embeddingExcluded &&
        embeddingToIndex.length > 0 &&
        (newEmbedding !== undefined || validatedInput.tags !== undefined)
      ) {
        await this.indexVector(ltmMemory, embeddingToIndex);
      }

      return ltmMemory;
    } catch (error) {
      // Not-found and version conflicts are expected control-flow, not DB faults —
      // surface them unchanged so callers can map them (T4 conflict → 409).
      if (error instanceof LtmMemoryNotFoundError || error instanceof LtmVersionConflictError) {
        throw error;
      }
      this.logger.error(`Failed to update LTM memory ${memoryId}: ${error}`);
      throw new LtmDatabaseError('update', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Regenerate the embedding for a memory's CURRENT content and re-index it,
   * clearing `metadata.embeddingStale` (WP2 T7/D10). Repairs a memory whose
   * content was edited during an embeddings outage.
   *
   * Deliberately does NOT bump `version`: re-sending identical content through
   * `update()` would trip the T4 compare-and-swap for other writers. `updatedAt`
   * is allowed to move. Throws `LtmEmbeddingUnavailableError` when no embedding
   * can be produced, leaving the staleness flag in place for a later retry.
   */
  async reembed(
    userId: string,
    memoryId: string,
    organizationId?: string,
    scope?: string
  ): Promise<LtmMemory> {
    const existingRow = await this.findRawMemory(userId, memoryId, organizationId, scope);
    if (!existingRow) {
      throw new LtmMemoryNotFoundError(memoryId);
    }
    const existing = this.mapToLtmMemory(existingRow);

    // An embeddingExcluded memory is intentionally absent from the vector index
    // (e.g. an import secret-scan `flag`) — there is nothing to re-embed. Return
    // it unchanged without contacting the embedding provider.
    if (this.readEmbeddingExcluded(existing.metadata)) {
      return existing;
    }

    if (!this.embeddingsService) {
      throw new LtmEmbeddingUnavailableError(memoryId);
    }
    const result = await this.embeddingsService
      .generate({ text: existing.content })
      .catch(() => null);
    if (!result?.embedding) {
      throw new LtmEmbeddingUnavailableError(memoryId);
    }

    const metadata = { ...(existing.metadata ?? {}) };
    delete metadata.embeddingStale;

    const updateWhere: Record<string, unknown> = {
      id: memoryId,
      userId,
      type: MemoryType.LONG_TERM,
    };
    if (organizationId !== undefined) {
      updateWhere.organizationId = organizationId;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (await (this.prisma as any).memory.update({
      where: updateWhere,
      data: { embedding: result.embedding, metadata },
    })) as PrismaMemory;

    const ltmMemory = this.mapToLtmMemory(updated);
    await this.indexVector(ltmMemory, result.embedding);
    return ltmMemory;
  }

  /**
   * Recreate a long-term memory from a delete snapshot, preserving its ORIGINAL
   * id so id-keyed vector upserts and inbound links stay valid (WP2 T5/G5). Runs
   * through the same quota-guarded insert path as `create`, re-embeds the content,
   * and re-indexes the vector. Fails with `LtmMemoryQuotaExceededError` if the
   * user is at quota, and is a no-op-safe recreate: if the id already exists the
   * Prisma insert throws and surfaces as a database error.
   */
  async restore(input: {
    id: string;
    userId: string;
    content: string;
    tags?: string[];
    metadata?: Record<string, unknown> | null;
    scope?: string | null;
    organizationId?: string | null;
  }): Promise<LtmMemory> {
    this.logger.debug(`Restoring LTM memory ${input.id} for user: ${input.userId}`);

    try {
      // Honor embeddingExcluded from the delete snapshot: a memory that was held
      // out of the index (e.g. an import secret-scan `flag`) is restored the same
      // way — no embedding is generated, so it never re-enters the vector store.
      let embedding: number[] = [];
      if (this.embeddingsService && !this.readEmbeddingExcluded(input.metadata)) {
        const result = await this.embeddingsService
          .generate({ text: input.content })
          .catch(() => null);
        embedding = result?.embedding ?? [];
      }

      const memory = await this.createRowWithQuota(input.userId, {
        id: input.id,
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        scope: input.scope ?? null,
        content: input.content,
        metadata: (input.metadata ?? null) as PrismaMemory['metadata'],
        tags: input.tags ?? [],
        type: MemoryType.LONG_TERM,
        expiresAt: null,
        embedding,
      });

      const ltmMemory = this.mapToLtmMemory(memory);
      if (embedding.length > 0) {
        await this.indexVector(ltmMemory, embedding);
      }
      return ltmMemory;
    } catch (error) {
      if (error instanceof LtmMemoryQuotaExceededError) {
        throw error;
      }
      this.logger.error(`Failed to restore LTM memory ${input.id}: ${error}`);
      throw new LtmDatabaseError('restore', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Delete a long-term memory.
   * Pass `organizationId` in user-facing paths to prevent cross-tenant deletes.
   * See `get()` for the full isolation contract.
   */
  async delete(
    userId: string,
    memoryId: string,
    organizationId?: string,
    scope?: string
  ): Promise<boolean> {
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
      // Namespace isolation: a scoped caller can only delete within its scope.
      if (scope !== undefined) {
        deleteWhere.scope = scope;
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
      if (validatedOptions.scope) {
        whereClause.scope = validatedOptions.scope;
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
      if (filters?.scope) {
        whereClause.scope = filters.scope;
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
   * Pass `organizationId` and `scope` to preserve both namespaces through the STM→LTM transfer.
   */
  async promote(
    userId: string,
    memoryId: string,
    organizationId?: string,
    scope?: string
  ): Promise<LtmMemory> {
    this.logger.debug(`Promoting memory ${memoryId} to LTM for user: ${userId}`);

    if (!this.stmService) {
      throw new LtmPromotionError(memoryId, 'STM service not available for promotion');
    }

    try {
      // Step 1: Get memory from STM service (org- and scope-scoped so we find
      // the right key and refuse to promote a memory from another namespace).
      const stmMemory = await this.stmService.findById(userId, memoryId, organizationId, scope);
      if (!stmMemory) {
        throw new LtmPromotionError(memoryId, 'Memory not found in short-term storage');
      }

      // Step 2: Pre-check quota to avoid a needless embeddings API call when over quota.
      await this.checkQuota(userId);

      // Org scope: prefer the explicit param, fall back to what's stored in the STM payload.
      const resolvedOrgId = organizationId ?? stmMemory.organizationId ?? null;
      // Namespace scope: prefer the explicit param, fall back to the STM payload scope.
      const resolvedScope = scope ?? stmMemory.scope ?? null;

      // Exact content dedup: if the STM content already exists verbatim in LTM,
      // skip promotion and return the existing memory without generating an embedding.
      const exactDup = await this.findExactDuplicate(
        userId,
        stmMemory.content,
        resolvedOrgId,
        resolvedScope ?? undefined
      );
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

      const duplicate = await this.findDuplicate(
        userId,
        resolvedOrgId ?? undefined,
        resolvedScope ?? undefined,
        embedding
      );
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

      // Step 4: Atomic quota check + insert-or-tier-flip (serialized per user
      // via a Postgres advisory lock), preserving the org scope from STM.
      // When the STM provider is Postgres-backed the source row already lives
      // in `memories`, so promotion updates it in place instead of inserting a
      // duplicate id.
      const result = await this.promoteRowWithQuota(userId, {
        id: stmMemory.id,
        userId: stmMemory.userId,
        organizationId: resolvedOrgId,
        scope: resolvedScope,
        content: stmMemory.content,
        metadata,
        tags: stmMemory.tags,
        type: MemoryType.LONG_TERM,
        createdAt: stmMemory.createdAt,
        updatedAt: new Date(),
        expiresAt: null,
        embedding,
      });

      // Step 5: Delete from STM storage (only after successful LTM creation).
      // With the Postgres STM adapter the row was flipped in place, so the
      // source no longer exists as short-term — that not-found is expected.
      try {
        await this.stmService.delete(userId, memoryId, organizationId ?? stmMemory.organizationId);
        this.logger.debug(`Successfully promoted memory ${memoryId} from STM to LTM`);
      } catch (stmDeleteError) {
        if ((stmDeleteError as Error | undefined)?.name === 'StmMemoryNotFoundError') {
          this.logger.debug(`STM source ${memoryId} already gone after in-place promotion`);
        } else {
          // Log warning but don't fail the operation since LTM creation succeeded
          this.logger.warn(
            `Failed to delete STM memory ${memoryId} after promotion: ${stmDeleteError}`
          );
        }
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
   * Atomically enforce the per-user LTM quota and insert the memory row.
   *
   * A plain `count` followed by `create` is a TOCTOU race: under READ
   * COMMITTED, N concurrent writers can all observe a count below the cap and
   * all insert, turning `maxMemoriesPerUser` into a soft limit. This helper
   * runs both steps in one transaction that first takes a per-user
   * `pg_advisory_xact_lock`, so same-user writers serialize: the lock is held
   * until commit/rollback, and each subsequent writer's `count` (a fresh
   * READ COMMITTED snapshot per statement) observes the previous writer's
   * committed insert. Different users hash to different lock keys and do not
   * contend. Throws {@link LtmMemoryQuotaExceededError} — same shape as the
   * pre-check — when the cap is reached; the transaction rolls back and no
   * row is written.
   */
  private async createRowWithQuota(
    userId: string,
    data: LtmMemoryCreateData
  ): Promise<PrismaMemory> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (this.prisma as any).$transaction(async (tx: any) => {
      // Per-user advisory lock: released automatically at commit/rollback.
      // Use $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns `void`,
      // which Prisma's $queryRaw result deserializer rejects ("Failed to
      // deserialize column of type 'void'"). $executeRaw runs the statement for
      // its side effect (acquiring the lock) and returns an affected-row count
      // without deserializing the column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LTM_QUOTA_LOCK_NAMESPACE}::int4, hashtext(${userId})::int4)`;

      const currentCount: number = await tx.memory.count({
        where: {
          userId: userId,
          type: MemoryType.LONG_TERM,
        },
      });

      this.logger.debug(
        `Atomic quota check for user ${userId}: ${currentCount}/${this.config.maxMemoriesPerUser}`
      );

      if (currentCount >= this.config.maxMemoriesPerUser) {
        throw new LtmMemoryQuotaExceededError(userId, this.config.maxMemoriesPerUser);
      }

      return (await tx.memory.create({ data })) as PrismaMemory;
    });
  }

  /**
   * Promotion write path: same advisory-lock quota transaction as
   * {@link createRowWithQuota}, but tier-aware. When the source short-term
   * row already lives in `memories` (Postgres STM adapter), promotion is an
   * in-place flip to long-term — inserting would violate the id uniqueness.
   * When STM lives elsewhere (in-process adapter), it inserts as before.
   * A concurrent double-promote still surfaces as P2002 on the create path,
   * which ConsolidationService already treats as "already promoted".
   */
  private async promoteRowWithQuota(
    userId: string,
    data: LtmMemoryCreateData & { id: string; createdAt: Date; updatedAt: Date }
  ): Promise<PrismaMemory> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LTM_QUOTA_LOCK_NAMESPACE}::int4, hashtext(${userId})::int4)`;

      const currentCount: number = await tx.memory.count({
        where: {
          userId: userId,
          type: MemoryType.LONG_TERM,
        },
      });

      if (currentCount >= this.config.maxMemoriesPerUser) {
        throw new LtmMemoryQuotaExceededError(userId, this.config.maxMemoriesPerUser);
      }

      const existing = await tx.memory.findUnique({ where: { id: data.id } });
      if (existing && existing.userId === userId && existing.type === MemoryType.SHORT_TERM) {
        return (await tx.memory.update({
          where: { id: data.id },
          data: {
            organizationId: data.organizationId,
            scope: data.scope,
            content: data.content,
            metadata: data.metadata,
            tags: data.tags,
            type: MemoryType.LONG_TERM,
            expiresAt: null,
            embedding: data.embedding,
            version: { increment: 1 },
          },
        })) as PrismaMemory;
      }

      return (await tx.memory.create({ data })) as PrismaMemory;
    });
  }

  /**
   * Fast-fail quota pre-check.
   *
   * NOT race-safe on its own — it exists only to skip expensive work (embedding
   * generation, dedup searches) for users who are already over quota. The
   * authoritative enforcement is the advisory-lock transaction in
   * {@link createRowWithQuota}, which every LTM insert path goes through.
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
   *
   * When the vector store is absent (profile-memory / profile-lite without a
   * remote vector backend) the call is transparently routed through
   * {@link HybridTransientRetriever} so the recall contract is preserved
   * across profiles.
   */
  async semanticSearch(
    userId: string,
    query: string,
    options?: SemanticSearchOptions
  ): Promise<SemanticSearchResult[]> {
    this.logger.debug(`Semantic search for user: ${userId}`);

    if (!this.vectorStore) {
      // Profile-memory / profile-lite: fall back to the in-process
      // hybrid retriever. The transient retriever is only registered
      // in profiles that don't pull a remote vector store, so the
      // presence check below is also a safety guard.
      if (this.transientRetriever) {
        return this.recallWithTransientRetriever(userId, query, options);
      }
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

      const includeSuperseded = options?.includeSuperseded === true;
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
        )
        // Drop superseded memories so a contradicted/stale fact never resurfaces
        // in recall; opt back in via `includeSuperseded` for audit/UI reads.
        .filter(
          (result: SemanticSearchResult) =>
            includeSuperseded || !this.isSuperseded(result.memory.metadata)
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
   * Profile-memory / profile-lite semantic recall via the
   * {@link HybridTransientRetriever}. Pulls every long-term memory for the
   * user from Postgres, indexes it in the retriever, and returns the
   * top-k matches.
   *
   * Org and tag filters are applied client-side after the retriever
   * produces candidates because the transient index is a single-user
   * snapshot (no remote coordination).
   */
  private async recallWithTransientRetriever(
    userId: string,
    query: string,
    options?: SemanticSearchOptions
  ): Promise<SemanticSearchResult[]> {
    const retriever = this.transientRetriever;
    if (!retriever) {
      return [];
    }
    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      return [];
    }
    const limit = options?.limit ?? 10;

    const where: Record<string, unknown> = {
      userId,
      type: MemoryType.LONG_TERM,
    };
    if (options?.organizationId) {
      where.organizationId = options.organizationId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: PrismaMemory[] = await (this.prisma as any).memory.findMany({ where });
    const includeSuperseded = options?.includeSuperseded === true;
    const memories = rows
      .map((row) => this.mapToLtmMemory(row))
      // Mirror the vector-store path: superseded memories are excluded from
      // recall pre-index unless the caller explicitly opts in.
      .filter((m) => includeSuperseded || !this.isSuperseded(m.metadata));

    // Apply tag scope filter pre-index so the retriever's postings reflect
    // only eligible memories.
    const filtered =
      options?.tags && options.tags.length > 0
        ? memories.filter((m) => options.tags!.some((t) => m.tags.includes(t)))
        : memories;

    retriever.index(filtered);

    // Best-effort query embedding for the semantic half of the search.
    let queryEmbedding: number[] | undefined;
    if (this.embeddingsService) {
      const result = await this.embeddingsService
        .generate({ text: trimmedQuery })
        .catch(() => null);
      queryEmbedding =
        result?.embedding && result.embedding.length > 0 ? result.embedding : undefined;
    }

    const results = retriever.search(trimmedQuery, queryEmbedding, limit);
    void this.recordAccessMany(results.map((r) => r.memory));
    return results;
  }

  /**
   * Return LTM memories that carry a given topic tag and have not yet been
   * clustered (i.e. not tagged `insight` or `clustered`). Used by the insight
   * extraction job. The `clustered` tag is written atomically with the
   * `insightId` metadata field in the same update call, so filtering by tag
   * is sufficient to exclude already-processed memories.
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
    let skippedConcurrentEdit = 0;
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
            // Version-guarded prune (G3-T3): retry once against the fresh row,
            // skip when a concurrent edit keeps winning or disqualifies the row.
            const outcome = await this.pruneWithCas(memory, {
              pruneScoreThreshold,
              pruneOlderThanDays,
            });
            if (outcome === 'pruned') {
              pruned += 1;
            } else if (outcome === 'conflict') {
              skippedConcurrentEdit += 1;
            }
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
            // Version-checked metadata rewrite (G3-T3): a concurrent user edit
            // between the batch read and this write must never be clobbered.
            const outcome = await this.decayMetadataWithCas(memory, nextMetadata);
            if (outcome === 'updated') {
              updated += 1;
            } else if (outcome === 'conflict') {
              skippedConcurrentEdit += 1;
            }
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

    return {
      processed,
      updated,
      pruned,
      stale,
      skippedConcurrentEdit,
      cursor: exhausted ? null : (cursor ?? null),
    };
  }

  /**
   * Version-guarded decay prune (G3-T3). Deletes the row only while its version
   * still matches the one the decay pass scored. On a miss the row is re-read
   * and RE-SCORED before the single retry — a concurrent user edit may have
   * boosted importance or pinned the memory, and blindly deleting with the
   * fresh version would clobber that edit. A second miss (or a disqualified
   * fresh row) skips the prune. Successful prunes emit a `delete` audit row
   * (system actor `ltm_decay`) whose `before` snapshot feeds `restore_memory`.
   */
  private async pruneWithCas(
    memory: LtmMemory,
    criteria: { pruneScoreThreshold: number; pruneOlderThanDays: number }
  ): Promise<'pruned' | 'conflict' | 'gone'> {
    let target = memory;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await this.casDelete(target)) {
        await this.removeVector([target.id]);
        await this.recordLifecycleAudit({
          memoryId: target.id,
          userId: target.userId,
          organizationId: target.organizationId ?? null,
          scope: target.scope ?? null,
          action: 'delete',
          actorId: 'ltm_decay',
          before: this.buildAuditSnapshot(target),
          after: { deleted: true, reason: 'decay_prune' },
        });
        return 'pruned';
      }
      if (attempt === 1) {
        break; // second guard miss — skip below, don't re-read again
      }

      const fresh = await this.findRawMemory(
        target.userId,
        target.id,
        target.organizationId ?? undefined
      );
      if (!fresh) {
        // Row already gone (concurrent delete) — nothing left to prune.
        return 'gone';
      }
      const freshMemory = this.mapToLtmMemory(fresh);
      const freshMeta = this.normalizeMetadata(freshMemory.metadata);
      const freshNext = this.annotateImportance(freshMeta, {
        content: freshMemory.content,
        metadata: freshMeta,
        tags: freshMemory.tags,
        accessCount: this.readAccessCount(freshMeta),
        pinned: this.readPinned(freshMeta),
        createdAt: freshMemory.createdAt,
        lastAccessedAt: this.readLastAccessedAt(freshMeta),
      });
      const stillQualifies =
        this.readImportance(freshNext) < criteria.pruneScoreThreshold &&
        this.ageDays(freshMemory.createdAt) >= criteria.pruneOlderThanDays &&
        !this.readPinned(freshNext);
      if (!stillQualifies) {
        this.logger.debug(
          `Skipping decay prune for memory ${target.id}: concurrent edit disqualified the row`
        );
        return 'conflict';
      }
      target = freshMemory;
    }
    this.logger.debug(
      `Skipping decay prune for memory ${memory.id}: version conflicted twice (concurrent edits win)`
    );
    return 'conflict';
  }

  /**
   * Version-checked decay metadata rewrite (G3-T3). On a CAS miss the
   * annotation is recomputed from the FRESH row — retrying with the originally
   * computed metadata would overwrite whatever the concurrent edit wrote. A
   * second miss skips the row; the next decay pass will converge it.
   */
  private async decayMetadataWithCas(
    memory: LtmMemory,
    nextMetadata: Record<string, unknown>
  ): Promise<'updated' | 'conflict' | 'noop'> {
    const first = await this.casMetadataUpdate(
      memory.id,
      memory.userId,
      memory.organizationId,
      memory.version,
      { metadata: nextMetadata }
    );
    if (first) {
      return 'updated';
    }

    const fresh = await this.findRawMemory(
      memory.userId,
      memory.id,
      memory.organizationId ?? undefined
    );
    if (!fresh) {
      return 'noop';
    }
    const freshMemory = this.mapToLtmMemory(fresh);
    const freshMeta = this.normalizeMetadata(freshMemory.metadata);
    const freshNext = this.annotateImportance(freshMeta, {
      content: freshMemory.content,
      metadata: freshMeta,
      tags: freshMemory.tags,
      accessCount: this.readAccessCount(freshMeta),
      pinned: this.readPinned(freshMeta),
      createdAt: freshMemory.createdAt,
      lastAccessedAt: this.readLastAccessedAt(freshMeta),
    });
    const freshStatus = typeof freshMeta['status'] === 'string' ? freshMeta['status'] : 'active';
    const nextStatus = typeof freshNext['status'] === 'string' ? freshNext['status'] : 'active';
    if (
      freshStatus === nextStatus &&
      Math.abs(this.readImportance(freshMeta) - this.readImportance(freshNext)) <= 0.01
    ) {
      // The concurrent edit already left the row consistent — nothing to write.
      return 'noop';
    }

    const second = await this.casMetadataUpdate(
      memory.id,
      memory.userId,
      memory.organizationId,
      freshMemory.version,
      { metadata: freshNext }
    );
    if (second) {
      return 'updated';
    }
    this.logger.debug(
      `Skipping decay metadata update for memory ${memory.id}: version conflicted twice`
    );
    return 'conflict';
  }

  /**
   * Drop and rebuild the vector index from scratch. Destructive and NOT atomic:
   * recall returns empty for all tenants until a subsequent reindex backfills
   * the index. Callers that chunk their own backfill (e.g. the async reindex
   * queue) invoke this exactly once up front, then reindex batch-by-batch with
   * `recreate: false` — the per-batch `recreate` guard in {@link reindex} would
   * otherwise skip the rebuild because every chunked call passes `maxMemories`.
   * No-op (with a warning) when no vector store is configured.
   */
  async recreateVectorIndex(): Promise<void> {
    if (!this.vectorStore) {
      this.logger.warn('Recreate requested but no vector store is configured');
      return;
    }
    this.logger.log('Recreating vector index (recall is unavailable until the rebuild completes)');
    await this.vectorStore.reset();
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
      if (options.recreate) {
        if (options.userId || options.cursor || maxMemories !== undefined) {
          // recreate wipes the entire index, so it is only safe for an
          // unscoped full rebuild — a scoped/capped run would clear vectors it
          // never re-indexes, breaking recall for everything outside its slice.
          this.logger.warn(
            'Ignoring recreate: the vector index may only be rebuilt by an unscoped full reindex (no userId, cursor, or maxMemories)'
          );
        } else {
          // NOTE: reset() is destructive and NOT atomic. It drops the whole
          // index up front, so recall returns empty for all tenants until the
          // backfill below completes, and a mid-run failure leaves the index
          // empty (re-run to recover — embeddings are reused from Postgres).
          this.logger.log(
            'Recreating vector index before reindex (recall is unavailable until the rebuild completes)'
          );
          await this.vectorStore.reset();
        }
      }

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
            const { vector: embedding, regenerated } = await this.resolveEmbedding(
              memory,
              reuseExisting
            );
            if (embedding.length === 0) {
              skipped += 1;
              continue;
            }
            // Postgres is the source of truth: persist a regenerated embedding
            // before indexing it, so a later reuse-based reindex works from the
            // new vectors instead of silently reverting to stale ones.
            if (regenerated) {
              await (this.prisma as any).memory.update({
                where: { id: memory.id },
                data: { embedding },
              });
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
   * service. Returns an empty vector when no embedding can be produced.
   * `regenerated` is true only for vectors freshly produced by the embeddings
   * service — those must be written back to Postgres (source of truth) so
   * later reuse-based reindexes do not revert to stale vectors.
   */
  private async resolveEmbedding(
    memory: LtmMemory,
    reuseExisting: boolean
  ): Promise<{ vector: number[]; regenerated: boolean }> {
    // An embeddingExcluded memory is never (re)indexed: return [] so the reindex
    // loop counts it as skipped and the row stays out of the vector store.
    if (this.readEmbeddingExcluded(memory.metadata)) {
      return { vector: [], regenerated: false };
    }
    if (reuseExisting && memory.embedding && memory.embedding.length > 0) {
      return { vector: memory.embedding, regenerated: false };
    }
    if (!this.embeddingsService) {
      return { vector: memory.embedding ?? [], regenerated: false };
    }
    const result = await this.embeddingsService
      .generate({ text: memory.content })
      .catch(() => null);
    if (result?.embedding) {
      return { vector: result.embedding, regenerated: true };
    }
    return { vector: memory.embedding ?? [], regenerated: false };
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
    organizationId?: string,
    scope?: string
  ): Promise<PrismaMemory | null> {
    const where: Record<string, unknown> = {
      id: memoryId,
      userId,
      type: MemoryType.LONG_TERM,
    };
    if (organizationId !== undefined) {
      where.organizationId = organizationId;
    }
    if (scope !== undefined) {
      where.scope = scope;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).memory.findFirst({ where }) as Promise<PrismaMemory | null>;
  }

  /**
   * Compare-and-swap metadata write for internal lifecycle paths (G3-T3).
   *
   * Mirrors the user-facing `update()`'s CAS semantics exactly — same `where`
   * shape (id + userId + type, plus organizationId when supplied) with the
   * expected version folded in, and a `version: { increment: 1 }` — so
   * lifecycle writes participate in the SAME optimistic-concurrency protocol
   * as user edits instead of silently clobbering them.
   *
   * `options.bumpVersion: false` keeps the version-KEYED `where` (a stale
   * write still can never clobber a concurrent edit — it just misses) but
   * skips the increment. Used ONLY by the access-bookkeeping hot path: get()
   * and recall() record accesses, so an access write that bumped `version`
   * would invalidate the version the caller just read and every
   * read-then-update flow using `expectedVersion` (G4-T2) would 409 against
   * its own access bump.
   *
   * Returns `null` when the CAS missed (version moved or row gone — Prisma
   * P2025); callers decide whether to re-read + retry once or skip. Non-P2025
   * errors are rethrown unchanged.
   *
   * Public-but-internal: exposed (not `private`) ONLY so
   * `CorpusConsolidationService` (G3-T2) can route its supersede/tag-union
   * writes through the exact same G3-T3 CAS protocol instead of duplicating
   * it. Not part of the app-facing API — application code must use `update()`.
   */
  async casMetadataUpdate(
    memoryId: string,
    userId: string,
    // `null` (from a mapped LtmMemory, where it is already coerced to
    // undefined at runtime) is treated like undefined: no org filter — same
    // as the user-facing update(), which can never receive null either.
    organizationId: string | null | undefined,
    expectedVersion: number,
    data: Record<string, unknown>,
    options: { bumpVersion?: boolean } = {}
  ): Promise<PrismaMemory | null> {
    const bumpVersion = options.bumpVersion ?? true;
    const where: Record<string, unknown> = {
      id: memoryId,
      userId,
      type: MemoryType.LONG_TERM,
      version: expectedVersion,
    };
    if (organizationId != null) {
      where.organizationId = organizationId;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated = await (this.prisma as any).memory.update({
        where,
        data: bumpVersion ? { ...data, version: { increment: 1 } } : { ...data },
      });
      return (updated ?? null) as PrismaMemory | null;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Version-guarded delete for lifecycle paths (G3-T3): same `where` shape as
   * {@link casMetadataUpdate} via `deleteMany`, so the row is only removed while
   * it still matches the version the caller evaluated. Returns false when the
   * guard missed (version moved or row gone).
   */
  private async casDelete(memory: LtmMemory): Promise<boolean> {
    const where: Record<string, unknown> = {
      id: memory.id,
      userId: memory.userId,
      type: MemoryType.LONG_TERM,
      version: memory.version,
    };
    if (memory.organizationId != null) {
      where.organizationId = memory.organizationId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (this.prisma as any).memory.deleteMany({ where });
    return result.count > 0;
  }

  /**
   * Pre-image snapshot for a lifecycle audit row. Matches the shape written by
   * the mcp-server audit trail (`MemorySnapshot` in WP2 T5's `snapshotOf`), so
   * `restore_memory` can rebuild a decay-pruned row from it: `{ content, tags,
   * metadata, type, scope, expiresAt, version }`.
   */
  private buildAuditSnapshot(memory: LtmMemory): Record<string, unknown> {
    return {
      content: memory.content,
      tags: memory.tags,
      metadata: memory.metadata,
      type: memory.type,
      scope: memory.scope ?? null,
      expiresAt: null, // LTM memories never expire
      version: memory.version,
    };
  }

  /**
   * Append a lifecycle mutation to the `memory_audits` trail (G3-T3).
   *
   * Same column shape as the mcp-server `MemoryAuditService.record()` write
   * (WP2 T5) — action `delete` rows here are picked up unchanged by
   * `findLatestDeleteSnapshot()` / `restore_memory` — but attributed to a
   * system actor (`actorType: 'system'`, `actorId` naming the job) because no
   * verified API-key principal exists inside a background job. Best-effort:
   * NEVER throws — a lost audit row must not fail the lifecycle mutation that
   * already happened.
   *
   * Public-but-internal (same rationale as {@link casMetadataUpdate}): shared
   * with `CorpusConsolidationService` (G3-T2, actor `corpus_consolidation`)
   * so there is exactly ONE lifecycle-audit writer.
   */
  async recordLifecycleAudit(entry: {
    memoryId: string;
    userId: string;
    organizationId: string | null;
    scope: string | null;
    action: 'delete' | 'supersede';
    actorId: 'ltm_decay' | 'dedup_supersede' | 'corpus_consolidation';
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.prisma as any).memoryAudit.create({
        data: {
          memoryId: entry.memoryId,
          userId: entry.userId,
          organizationId: entry.organizationId,
          scope: entry.scope,
          action: entry.action,
          actorType: 'system',
          actorId: entry.actorId,
          actorLabel: null,
          delegated: false,
          before: entry.before,
          after: entry.after,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write lifecycle audit (action=${entry.action} memory=${entry.memoryId}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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

  /**
   * A memory flagged `embeddingExcluded` must never be sent to the external
   * embedding provider — set e.g. by the import secret-scan `flag` policy. Both
   * the create path and reindex honor it so the row stays out of the vector index.
   */
  private readEmbeddingExcluded(metadata: Record<string, unknown> | null | undefined): boolean {
    return metadata?.['embeddingExcluded'] === true;
  }

  /**
   * A memory is superseded once a later contradicting write records it as such.
   * Keys on the `supersededBy` audit marker rather than `status === 'superseded'`
   * because the decay pass rewrites `status` (active/stale/archived) on every
   * run and would otherwise silently un-hide a superseded memory; `supersededBy`
   * is written once by {@link ContradictionDetectionService.annotateSuperseded}
   * and never cleared. Falls back to the legacy `status` marker for rows written
   * before `supersededBy` existed.
   */
  private isSuperseded(metadata: Record<string, unknown> | null | undefined): boolean {
    if (!metadata) return false;
    const supersededBy = metadata['supersededBy'];
    if (typeof supersededBy === 'string' && supersededBy.length > 0) return true;
    return metadata['status'] === 'superseded';
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
    organizationId: string | null | undefined,
    scope?: string
  ): Promise<PrismaMemory | null> {
    const where: Record<string, unknown> = {
      userId,
      content,
      type: MemoryType.LONG_TERM,
    };
    if (organizationId !== undefined) {
      where.organizationId = organizationId;
    }
    // Always constrain by namespace for dedup. Note that `scope` is treated differently
    // here than in read/update/delete paths: `undefined` means "unscoped only"
    // (scope IS NULL), not "no scope filter".
    where.scope = scope ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).memory.findFirst({ where }) as Promise<PrismaMemory | null>;
  }

  /**
   * Keep only candidates that share the create's namespace. The vector store
   * filter cannot express "scope IS NULL", so for an unscoped create we drop any
   * hit that carries a scope in its payload; for a scoped create the store has
   * already filtered, and this simply re-asserts the invariant.
   */
  private hitMatchesScope(hit: VectorSearchResult, scope: string | undefined): boolean {
    const hitScope =
      typeof hit.payload?.scope === 'string' && hit.payload.scope.length > 0
        ? hit.payload.scope
        : undefined;
    return hitScope === scope;
  }

  private async findDuplicate(
    userId: string,
    organizationId: string | undefined,
    scope: string | undefined,
    embedding: number[]
  ): Promise<DuplicateDetectionMatch | null> {
    if (!this.vectorStore || !this.duplicateDetectionService || embedding.length === 0) {
      return null;
    }
    const hits = await this.vectorStore.search(
      embedding,
      { userId, organizationId, scope, type: MemoryType.LONG_TERM },
      3
    );
    const scopedHits = hits.filter((hit) => this.hitMatchesScope(hit, scope));
    return this.duplicateDetectionService.findMatch(scopedHits);
  }

  private async findContradictionCandidate(
    userId: string,
    organizationId: string | undefined,
    scope: string | undefined,
    content: string,
    embedding: number[]
  ): Promise<ContradictionMatch | null> {
    if (!this.vectorStore || !this.contradictionDetectionService || embedding.length === 0) {
      return null;
    }
    const hits = await this.vectorStore.search(
      embedding,
      { userId, organizationId, scope, type: MemoryType.LONG_TERM },
      5
    );
    if (hits.length === 0) return null;

    // Fetch content for all hit candidates in one query, scoped to the same
    // tenant *and namespace* so neither a vector-store misconfiguration nor an
    // unscoped search can surface foreign rows. `scope ?? null` confines the
    // match to the create's own namespace (NULL = unscoped).
    const hitIds = hits.map((h) => h.id);
    const contentWhere: Record<string, unknown> = {
      id: { in: hitIds },
      userId,
      type: MemoryType.LONG_TERM,
      scope: scope ?? null,
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

  /**
   * Mark an older contradicted memory as superseded (hidden from default
   * recall). Version-checked (G3-T3): the supersede marker is merged into the
   * row version we read; on a CAS miss we re-read and retry ONCE so the marker
   * lands on the CURRENT metadata, and skip after a second conflict rather
   * than clobber a concurrent user edit. Emits a `supersede` audit row
   * (system actor `dedup_supersede`) because hiding a row from recall is a
   * user-visible mutation.
   */
  private async markSuperseded(
    memoryId: string,
    supersededById: string,
    reason: string,
    userId: string,
    organizationId: string | undefined
  ): Promise<void> {
    let existing = await this.findRawMemory(userId, memoryId, organizationId);
    if (!existing) return;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const updatedMeta = this.contradictionDetectionService!.annotateSuperseded(
        existing.metadata as Record<string, unknown> | null,
        supersededById,
        reason
      );
      const updated = await this.casMetadataUpdate(
        memoryId,
        userId,
        organizationId,
        existing.version,
        {
          metadata: updatedMeta,
        }
      );
      if (updated) {
        this.logger.debug(`Memory ${memoryId} marked superseded by ${supersededById}`);
        await this.recordLifecycleAudit({
          memoryId,
          userId,
          organizationId: existing.organizationId ?? null,
          scope: existing.scope ?? null,
          action: 'supersede',
          actorId: 'dedup_supersede',
          before: this.buildAuditSnapshot(this.mapToLtmMemory(existing)),
          after: { superseded: true, supersededBy: supersededById, supersededReason: reason },
        });
        return;
      }
      if (attempt === 1) {
        break; // second CAS miss — skip below, don't re-read again
      }
      // CAS missed: re-read and retry once so the marker merges into the
      // concurrent edit's metadata instead of overwriting it.
      const fresh = await this.findRawMemory(userId, memoryId, organizationId);
      if (!fresh) return; // row deleted concurrently — nothing left to supersede
      existing = fresh;
    }
    this.logger.debug(
      `Skipping supersede for memory ${memoryId}: version conflicted twice (concurrent edits win)`
    );
  }

  /**
   * Mark an existing memory as contradicted-but-kept (G3-T4, policy `flag`).
   *
   * Version-checked exactly like {@link markSuperseded} (G3-T3): the review
   * metadata is CAS'd against the row version we read, retried ONCE against a
   * fresh read so it merges into a concurrent edit's metadata instead of
   * overwriting it, and skipped after a second conflict.
   *
   * Deliberately does NOT emit a lifecycle audit row: unlike supersede (which
   * hides the row from recall and is therefore a user-visible mutation),
   * flagging only ADDS review metadata — both rows remain fully visible in
   * default recall, so there is no hidden state for an audit trail to recover.
   */
  private async markContradicted(
    memoryId: string,
    counterpartId: string,
    reason: string,
    userId: string,
    organizationId: string | undefined
  ): Promise<void> {
    let existing = await this.findRawMemory(userId, memoryId, organizationId);
    if (!existing) return;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const updatedMeta = this.contradictionDetectionService!.annotateContradicted(
        existing.metadata as Record<string, unknown> | null,
        counterpartId,
        reason
      );
      const updated = await this.casMetadataUpdate(
        memoryId,
        userId,
        organizationId,
        existing.version,
        {
          metadata: updatedMeta,
        }
      );
      if (updated) {
        this.logger.debug(`Memory ${memoryId} flagged as contradicted by ${counterpartId}`);
        return;
      }
      if (attempt === 1) {
        break; // second CAS miss — skip below, don't re-read again
      }
      // CAS missed: re-read and retry once so the review fields merge into the
      // concurrent edit's metadata instead of overwriting it.
      const fresh = await this.findRawMemory(userId, memoryId, organizationId);
      if (!fresh) return; // row deleted concurrently — nothing left to flag
      existing = fresh;
    }
    this.logger.debug(
      `Skipping contradiction flag for memory ${memoryId}: version conflicted twice (concurrent edits win)`
    );
  }

  /**
   * Link a contradicted pair with a `contradicts` MemoryLink (G3-T4, policy
   * `flag`). `contradicts` comes from the closed EDGE_TYPES vocabulary
   * (@engram/memory-interchange) and is its own inverse, so a single row —
   * written source=new, target=existing by convention — captures the relation
   * in both directions. `origin: 'derived'` because the edge is reproducible
   * by re-running detection (WP3 §4.3). Idempotent via the
   * (sourceMemoryId, targetLocator, relType) unique key, mirroring the WP4
   * link-resolver upsert. Best-effort: callers `.catch()` this — a lost link
   * never fails the create that already happened.
   */
  private async linkContradiction(
    sourceMemoryId: string,
    targetMemoryId: string,
    match: ContradictionMatch,
    userId: string,
    organizationId: string | undefined
  ): Promise<void> {
    const targetLocator = `id:${targetMemoryId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.prisma as any).memoryLink.upsert({
      where: {
        sourceMemoryId_targetLocator_relType: {
          sourceMemoryId,
          targetLocator,
          relType: 'contradicts',
        },
      },
      create: {
        userId,
        organizationId: organizationId ?? null,
        sourceMemoryId,
        targetMemoryId,
        targetLocator,
        relType: 'contradicts',
        origin: 'derived',
        score: match.score,
        note: match.reason,
      },
      update: { targetMemoryId, score: match.score, note: match.reason },
    });
  }

  /**
   * Annotate an existing memory as the dedup target of a new write and return
   * it. Version-checked (G3-T3): the duplicate annotation is CAS'd against the
   * row version we read, retried ONCE against a fresh read, and DROPPED after a
   * second conflict — losing a `duplicateMatches` annotation is acceptable;
   * overwriting a concurrent user edit's metadata is not. Metadata-only
   * bookkeeping, so no audit row is emitted.
   */
  private async linkDuplicateAndReturn(
    memoryId: string,
    userId: string,
    organizationId: string | undefined,
    score: number,
    content: string
  ): Promise<LtmMemory> {
    let existing = await this.findRawMemory(userId, memoryId, organizationId);
    if (!existing) {
      throw new LtmMemoryNotFoundError(memoryId);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
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
      const updated = await this.casMetadataUpdate(
        memoryId,
        userId,
        organizationId,
        existingMemory.version,
        { metadata }
      );
      if (updated) {
        return this.mapToLtmMemory(updated);
      }
      const fresh = await this.findRawMemory(userId, memoryId, organizationId);
      if (!fresh) {
        throw new LtmMemoryNotFoundError(memoryId);
      }
      existing = fresh;
    }
    // Two CAS misses: concurrent writers own this row right now. Return it
    // without the duplicate annotation rather than clobbering their writes.
    this.logger.debug(
      `Skipping duplicate annotation for memory ${memoryId}: version conflicted twice`
    );
    return this.mapToLtmMemory(existing);
  }

  /**
   * Best-effort access bookkeeping on the recall/get hot path. Version-checked
   * (G3-T3) so a stale access bump can never overwrite a concurrent user edit's
   * metadata — but deliberately WITHOUT a retry: on a version conflict the bump
   * is simply dropped (a lost access count is acceptable; extra reads in the
   * hot path are not). Never throws.
   *
   * Deliberately does NOT bump `version` (`bumpVersion: false`): get()/recall()
   * fire this after handing the row to the caller, so incrementing here would
   * invalidate the version the caller just read — every read-then-update flow
   * with `expectedVersion` (required by update_memory since G4-T2) would 409
   * against its own access bookkeeping.
   */
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
      const updated = await this.casMetadataUpdate(
        memory.id,
        memory.userId,
        memory.organizationId,
        memory.version,
        { metadata },
        { bumpVersion: false }
      );
      if (!updated) {
        this.logger.debug(
          `Skipped access bump for memory ${memory.id}: version moved (concurrent edit wins)`
        );
      }
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
    if (memory.scope) {
      payload.scope = memory.scope;
    }
    return payload;
  }

  /**
   * Map Prisma Memory to LtmMemory type
   */
  private mapToLtmMemory(memory: PrismaMemory): LtmMemory {
    return {
      ...memory,
      organizationId: memory.organizationId ?? undefined,
      scope: memory.scope ?? undefined,
      type: 'long-term' as const,
      expiresAt: null,
      metadata: memory.metadata as Record<string, unknown> | null,
      embedding: memory.embedding ?? [],
    };
  }
}
