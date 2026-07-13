import { z } from 'zod';
import { cursorIdSchema, Memory, userIdSchema } from '@engram/database';

// LTM-specific configuration
export interface LtmConfig {
  maxMemoriesPerUser: number;
  defaultPageSize: number;
  maxPageSize: number;
}

export const DEFAULT_LTM_CONFIG: LtmConfig = {
  maxMemoriesPerUser: 10000, // Reasonable limit for long-term storage
  defaultPageSize: 20,
  maxPageSize: 100,
};

// Long-term memory (extends base Memory)
export interface LtmMemory extends Memory {
  type: 'long-term';
  expiresAt: null; // LTM memories never expire
  /**
   * Optimistic-concurrency counter (WP2 T4/G4). Defaults to 1 at the DB level;
   * bumped on every update. Enforced via a compare-and-swap `where` clause.
   */
  version: number;
}

// LTM creation input
export interface CreateLtmMemoryData {
  userId: string;
  organizationId?: string;
  /** Optional namespace for agent/session/project isolation. */
  scope?: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  skipDuplicateCheck?: boolean;
}

// LTM update input
export interface UpdateLtmMemoryData {
  content?: string;
  /**
   * Full metadata replacement. When provided, takes precedence over `metadataMerge`;
   * do not pass both in the same call.
   */
  metadata?: Record<string, unknown>;
  /** Shallow-merge these fields into existing metadata instead of replacing it. */
  metadataMerge?: Record<string, unknown>;
  tags?: string[];
  /**
   * Optimistic-concurrency guard (WP2 T4). When set, the update fails with
   * `LtmVersionConflictError` unless it matches the stored version. Optional so
   * legacy callers keep last-write-wins.
   */
  expectedVersion?: number;
}

// LTM query options
export interface LtmQueryOptions {
  limit?: number;
  cursor?: string;
  organizationId?: string;
  /** Optional namespace filter; omit to return all scopes. */
  scope?: string;
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

// Options for semantic (vector) recall
export interface SemanticSearchOptions {
  /** Maximum number of results to return. */
  limit?: number;
  /** When set, restricts results to the given organization's memories. */
  organizationId?: string;
  /** Optional logical namespace filter (agent / session / project). */
  scope?: string;
  /** Restrict results to memories carrying all of these tags. */
  tags?: string[];
  /** Only return memories created on or after this time. */
  createdFrom?: Date;
  /** Only return memories created on or before this time. */
  createdTo?: Date;
  /**
   * Relative weights for the blended ranking score.
   * Values are normalised internally so they need not sum to 1.
   * Omit any key to use the package default.
   */
  rankingWeights?: Partial<import('./rank').RankingWeights>;
  /**
   * Half-life in calendar days for the recency decay component.
   * A memory created exactly `recencyHalfLifeDays` ago receives a recency
   * score of 0.5. Must be a positive finite number; defaults to 30 days.
   * Non-positive or non-finite values are silently replaced with the default.
   */
  recencyHalfLifeDays?: number;
  /**
   * Include memories that have been superseded by a later contradicting write.
   * Defaults to `false`: superseded memories are dropped from recall so a stale
   * or contradicted fact never resurfaces. Audit/UI callers that need the full
   * history set this to `true`; superseded rows always remain fetchable by id
   * via `findById` regardless of this flag.
   */
  includeSuperseded?: boolean;
}

// A semantic-search hit: a memory plus its relevance score
export interface SemanticSearchResult {
  memory: LtmMemory;
  /** Blended relevance score combining similarity, recency, and importance (always in [0, 1] after ranking). Higher is more relevant. */
  score: number;
}

// Options for backfilling / reindexing the vector store from Postgres
export interface ReindexOptions {
  /** Restrict the reindex to a single user. Omit to reindex every user. */
  userId?: string;
  /** Number of memories to load per page. Defaults to 100. */
  batchSize?: number;
  /**
   * When true (default), memories that already have an embedding are reused and
   * only mirrored into the vector store. When false, embeddings are regenerated
   * for every memory (useful after an embedding-model change).
   */
  reuseExistingEmbeddings?: boolean;
  /**
   * Resume from a previously returned cursor. Pair with `batchSize` to process
   * large datasets across multiple invocations.
   */
  cursor?: string;
  /** Stop after processing at most this many memories. */
  maxMemories?: number;
  /**
   * When true, drop and rebuild the entire vector index before reindexing, so
   * the backfill is clean and leaves no orphaned points. Only honoured for an
   * unscoped full reindex (no `userId`, `cursor`, or `maxMemories`); ignored
   * otherwise. The rebuild is destructive and NOT atomic: recall is empty for
   * all tenants until it completes, and a mid-run failure leaves the index
   * empty (safe to re-run — embeddings are reused from Postgres).
   */
  recreate?: boolean;
  /** Invoked after each batch with cumulative progress. */
  onProgress?: (progress: ReindexProgress) => void;
}

// Cumulative progress emitted during a reindex run
export interface ReindexProgress {
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
  /** Cursor to resume from, or null when the run is complete. */
  cursor: string | null;
}

// Final summary returned by a reindex run
export interface ReindexResult extends ReindexProgress {
  cursor: string | null;
}

export interface ImportanceFactors {
  base: number;
  recencyMultiplier: number;
  accessBoost: number;
  cueBoost: number;
  pinBoost: number;
}

export interface ImportanceScoreResult {
  score: number;
  status: 'active' | 'stale' | 'archived' | 'pinned';
  factors: ImportanceFactors;
  reasons: string[];
}

export interface ImportanceSignals {
  content: string;
  metadata?: Record<string, unknown> | null;
  tags?: string[];
  accessCount?: number;
  pinned?: boolean;
  createdAt?: Date;
  lastAccessedAt?: Date | string | null;
}

export interface DuplicateDetectionMatch {
  memoryId: string;
  score: number;
}

export type ContradictionAction = 'superseded' | 'flagged';

/**
 * Boot-configured handling for a detected contradiction (G3-T4,
 * `MEMORY_CONTRADICTION_POLICY`):
 *  - `flag` (default) — keep BOTH rows visible in recall; each is marked
 *    `status: 'contradicted'` with review metadata pointing at the other,
 *    and the pair is linked with a `contradicts` MemoryLink.
 *  - `supersede` — latest-wins: the older row is hidden from default recall
 *    via the `supersededBy` marker (pre-G3-T4 behaviour).
 */
export type ContradictionPolicy = 'supersede' | 'flag';

export interface ContradictionMatch {
  memoryId: string;
  score: number;
  action: ContradictionAction;
  reason: string;
}

export interface ContradictionCandidate {
  id: string;
  score: number;
  content: string;
}

export interface DecayPolicyOptions {
  userId?: string;
  batchSize?: number;
  cursor?: string;
  staleScoreThreshold?: number;
  pruneScoreThreshold?: number;
  pruneOlderThanDays?: number;
  dryRun?: boolean;
}

export interface DecayPolicyResult {
  processed: number;
  updated: number;
  pruned: number;
  stale: number;
  /**
   * Rows the decay pass SKIPPED because a concurrent edit moved the row's
   * version twice (or disqualified it) between read and write (G3-T3 —
   * lifecycle writes never clobber a concurrent user edit). Optional so
   * pre-G3-T3 callers constructing empty results stay source-compatible;
   * `applyDecayPolicy` always sets it.
   */
  skippedConcurrentEdit?: number;
  cursor: string | null;
}

// Zod validation schemas

// Create LTM memory schema
export const createLtmMemorySchema = z.object({
  userId: userIdSchema,
  organizationId: z.string().cuid2().optional(),
  scope: z.string().min(1).max(256).optional(),
  content: z.string().min(1, 'Content cannot be empty').max(10240, 'Content cannot exceed 10KB'),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
});

// Update LTM memory schema
export const updateLtmMemorySchema = z.object({
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(10240, 'Content cannot exceed 10KB')
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  metadataMerge: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  expectedVersion: z.number().int().min(1).optional(),
});

// LTM query options schema
export const ltmQueryOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  cursor: cursorIdSchema.optional(),
  organizationId: z.string().cuid2().optional(),
  scope: z.string().min(1).max(256).optional(),
  tags: z.array(z.string()).optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  search: z.string().max(500).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// Type exports
export type CreateLtmMemoryValidated = z.infer<typeof createLtmMemorySchema>;
export type UpdateLtmMemoryValidated = z.infer<typeof updateLtmMemorySchema>;
export type LtmQueryOptionsValidated = z.infer<typeof ltmQueryOptionsSchema>;

// Custom error types for LTM operations
export class LtmMemoryNotFoundError extends Error {
  constructor(memoryId: string) {
    super(`Long-term memory with ID ${memoryId} not found`);
    this.name = 'LtmMemoryNotFoundError';
  }
}

/**
 * Raised by `reembed()` when the embeddings provider is unavailable or its
 * generation fails (WP2 T7/D10). The staleness flag stays set so the repair can
 * be retried once the provider is back.
 */
export class LtmEmbeddingUnavailableError extends Error {
  constructor(memoryId: string) {
    super(`Cannot re-embed memory ${memoryId}: the embeddings provider is unavailable`);
    this.name = 'LtmEmbeddingUnavailableError';
  }
}

/**
 * Raised when an update's `expectedVersion` no longer matches the stored version
 * (WP2 T4/G4 — optimistic concurrency). Carries the current version so the caller
 * can reload and re-diff.
 */
export class LtmVersionConflictError extends Error {
  constructor(
    memoryId: string,
    readonly currentVersion: number
  ) {
    super(`Long-term memory ${memoryId} was modified (currentVersion=${currentVersion})`);
    this.name = 'LtmVersionConflictError';
  }
}

export class LtmMemoryQuotaExceededError extends Error {
  constructor(userId: string, limit: number) {
    super(`Long-term memory quota exceeded for user ${userId}. Limit: ${limit} memories`);
    this.name = 'LtmMemoryQuotaExceededError';
  }
}

export class LtmPromotionError extends Error {
  constructor(memoryId: string, reason: string) {
    super(`Failed to promote memory ${memoryId} to long-term storage: ${reason}`);
    this.name = 'LtmPromotionError';
  }
}

export class LtmDatabaseError extends Error {
  constructor(operation: string, reason: string) {
    super(`Database error during ${operation}: ${reason}`);
    this.name = 'LtmDatabaseError';
  }
}

// Validation helper functions
export const validateCreateLtmMemory = (data: unknown): CreateLtmMemoryValidated => {
  return createLtmMemorySchema.parse(data);
};

export const validateUpdateLtmMemory = (data: unknown): UpdateLtmMemoryValidated => {
  return updateLtmMemorySchema.parse(data);
};

export const validateLtmQueryOptions = (data: unknown): LtmQueryOptionsValidated => {
  return ltmQueryOptionsSchema.parse(data);
};
