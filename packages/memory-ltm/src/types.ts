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
}

// LTM creation input
export interface CreateLtmMemoryData {
  userId: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

// LTM update input
export interface UpdateLtmMemoryData {
  content?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

// LTM query options
export interface LtmQueryOptions {
  limit?: number;
  cursor?: string;
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
  /** Optional logical namespace filter (agent / session / project). */
  scope?: string;
  /** Restrict results to memories carrying all of these tags. */
  tags?: string[];
  /** Only return memories created on or after this time. */
  createdFrom?: Date;
  /** Only return memories created on or before this time. */
  createdTo?: Date;
}

// A semantic-search hit: a memory plus its similarity score
export interface SemanticSearchResult {
  memory: LtmMemory;
  /** Similarity score from the vector store (higher is more similar). */
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

// Zod validation schemas

// Create LTM memory schema
export const createLtmMemorySchema = z.object({
  userId: userIdSchema,
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
  tags: z.array(z.string()).optional(),
});

// LTM query options schema
export const ltmQueryOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  cursor: cursorIdSchema.optional(),
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
