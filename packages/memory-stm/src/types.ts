import { z } from 'zod';
import { cursorIdSchema, Memory, userIdSchema } from '@engram/database';

// STM-specific configuration
export interface StmConfig {
  defaultTtl: number; // Default TTL in seconds (24 hours)
  maxTtl: number; // Maximum TTL in seconds (7 days)
  minTtl: number; // Minimum TTL in seconds (1 minute)
}

// STM creation options
export interface CreateStmMemoryOptions {
  metadata?: Record<string, unknown>;
  tags?: string[];
  ttl?: number; // TTL in seconds
}

// STM update options
export interface UpdateStmMemoryOptions {
  content?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  ttl?: number; // New TTL in seconds
}

// STM list options
export interface ListStmMemoryOptions {
  limit?: number;
  cursor?: string;
  tags?: string[];
  organizationId?: string;
}

// Paginated result for list operations
export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

// STM Memory (extends base Memory with STM-specific properties)
export interface StmMemory extends Memory {
  type: 'short-term';
  expiresAt: Date; // Always set for STM
  ttl: number; // Current TTL in seconds
  /**
   * Optimistic-concurrency counter (WP2 T4/G4). Stamped `1` on create, bumped on
   * every update. Legacy payloads without it are treated as version 1 on read.
   */
  version: number;
  /**
   * Number of times this memory has been retrieved via findById().
   * Used by the consolidation policy to identify frequently-accessed memories
   * that should be promoted to LTM. Only direct lookups are counted; list()
   * scans do not increment this counter.
   */
  accessCount: number;
  /** Organization scope; absent for personal (non-org) memories. */
  organizationId?: string;
  /** Optional namespace for agent/session/project isolation. */
  scope?: string;
}

// Validation schemas for STM operations

// Content validation (max 10KB = 10,240 characters)
const contentSchema = z
  .string()
  .min(1, 'Content cannot be empty')
  .max(10240, 'Content cannot exceed 10KB (10,240 characters)');

// Metadata validation (optional JSON object)
const metadataSchema = z.record(z.string(), z.unknown()).optional();

// Tags validation (array of strings, max 50 tags, each max 100 chars)
const tagsSchema = z
  .array(z.string().min(1, 'Tag cannot be empty').max(100, 'Tag cannot exceed 100 characters'))
  .max(50, 'Cannot have more than 50 tags')
  .optional()
  .default([]);

// TTL validation for short-term memories (in seconds)
const ttlSchema = z
  .number()
  .int('TTL must be an integer')
  .min(60, 'TTL must be at least 1 minute (60 seconds)')
  .max(604800, 'TTL cannot exceed 7 days (604800 seconds)')
  .optional();

// Create STM memory schema
export const createStmMemorySchema = z.object({
  userId: userIdSchema,
  organizationId: z.string().cuid2().optional(),
  scope: z.string().min(1).max(256).optional(),
  content: contentSchema,
  metadata: metadataSchema,
  tags: tagsSchema.optional(),
  ttl: ttlSchema,
});

// Update STM memory schema (all fields optional for partial updates)
export const updateStmMemorySchema = z.object({
  content: contentSchema.optional(),
  metadata: metadataSchema,
  tags: tagsSchema,
  ttl: ttlSchema,
  /**
   * Optimistic-concurrency guard (WP2 T4). When set, the update fails with
   * `StmVersionConflictError` unless it matches the stored version. Optional so
   * legacy callers keep last-write-wins.
   */
  expectedVersion: z.number().int().min(1).optional(),
});

// List STM options schema
export const listStmOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  cursor: z
    .union([z.literal('0'), cursorIdSchema])
    .optional()
    .default('0'),
  tags: z.array(z.string()).optional(),
  organizationId: z.string().cuid2().optional(),
  scope: z.string().min(1).max(256).optional(),
});

// Type exports
export type CreateStmMemoryData = z.infer<typeof createStmMemorySchema>;
export type UpdateStmMemoryData = z.infer<typeof updateStmMemorySchema>;
export type ListStmOptionsData = z.infer<typeof listStmOptionsSchema>;

// STM-specific error classes
export class StmMemoryNotFoundError extends Error {
  constructor(memoryId: string) {
    super(`STM Memory with ID ${memoryId} not found`);
    this.name = 'StmMemoryNotFoundError';
  }
}

export class StmMemoryExpiredError extends Error {
  constructor(memoryId: string) {
    super(`STM Memory with ID ${memoryId} has expired`);
    this.name = 'StmMemoryExpiredError';
  }
}

/**
 * Raised when an update's `expectedVersion` does not match the stored version
 * (WP2 T4/G4 — optimistic concurrency). Carries the current version so the
 * caller can reload and re-diff.
 */
export class StmVersionConflictError extends Error {
  constructor(
    memoryId: string,
    readonly currentVersion: number
  ) {
    super(`STM memory ${memoryId} was modified (currentVersion=${currentVersion})`);
    this.name = 'StmVersionConflictError';
  }
}

export class StmTtlValidationError extends Error {
  constructor(ttl: number, minTtl: number, maxTtl: number) {
    super(`TTL ${ttl} is invalid. Must be between ${minTtl} and ${maxTtl} seconds`);
    this.name = 'StmTtlValidationError';
  }
}

// Default STM configuration
export const DEFAULT_STM_CONFIG: StmConfig = {
  defaultTtl: 86400, // 24 hours
  maxTtl: 604800, // 7 days
  minTtl: 60, // 1 minute
};
