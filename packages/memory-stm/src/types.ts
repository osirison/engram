import { z } from 'zod';
import { cursorIdSchema, Memory, userIdSchema } from '@engram/database';

// STM-specific configuration
export interface StmConfig {
  defaultTtl: number; // Default TTL in seconds (24 hours)
  maxTtl: number; // Maximum TTL in seconds (7 days)
  minTtl: number; // Minimum TTL in seconds (1 minute)
  keyPrefix: string; // Redis key prefix
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

export class StmTtlValidationError extends Error {
  constructor(ttl: number, minTtl: number, maxTtl: number) {
    super(`TTL ${ttl} is invalid. Must be between ${minTtl} and ${maxTtl} seconds`);
    this.name = 'StmTtlValidationError';
  }
}

// Redis key helpers
export class StmKeyBuilder {
  constructor(private readonly prefix: string = 'memory:stm') {}

  /**
   * Build Redis key for a memory.
   *
   * Key format:
   * - Org-scoped:  `{prefix}:{orgId}:{userId}:{memoryId}` (prefixParts + 3 segments)
   * - Personal:    `{prefix}:{userId}:{memoryId}` (prefixParts + 2 segments)
   */
  buildMemoryKey(userId: string, memoryId: string, organizationId?: string): string {
    if (organizationId) {
      return `${this.prefix}:${organizationId}:${userId}:${memoryId}`;
    }
    return `${this.prefix}:${userId}:${memoryId}`;
  }

  /**
   * Build Redis SCAN pattern for a user's memories.
   *
   * - With `organizationId`: matches only keys in that org's namespace.
   * - Without: matches only the user's personal (non-org) keys.
   *
   * To scan across both namespaces, call `buildGlobalPattern()` and
   * filter the results by `extractUserId`.
   */
  buildUserPattern(userId: string, organizationId?: string): string {
    if (organizationId) {
      return `${this.prefix}:${organizationId}:${userId}:*`;
    }
    return `${this.prefix}:${userId}:*`;
  }

  /**
   * Build Redis key pattern matching all STM memories across all users.
   * Used by the consolidation job to scan for promotion candidates.
   */
  buildGlobalPattern(): string {
    return `${this.prefix}:*`;
  }

  /**
   * Extract memory ID from Redis key (last segment).
   * Works for both 4-segment and 5-segment key formats.
   */
  extractMemoryId(key: string): string | null {
    const parts = key.split(':');
    const memoryId = parts[parts.length - 1];
    return memoryId && memoryId.length > 0 ? memoryId : null;
  }

  /**
   * Extract user ID from Redis key (second-to-last segment).
   * Works for both 4-segment and 5-segment key formats.
   */
  extractUserId(key: string): string | null {
    const parts = key.split(':');
    const userId = parts[parts.length - 2];
    return userId && userId.length > 0 ? userId : null;
  }

  /**
   * Extract organization ID from Redis key.
   * Returns null for personal (prefixParts + 2 segment) keys.
   *
   * Uses the prefix colon-count to determine the expected segment lengths so
   * a prefix containing extra `:` characters does not cause misclassification.
   */
  extractOrgId(key: string): string | null {
    const prefixParts = this.prefix.split(':').length;
    const parts = key.split(':');
    // Org-scoped key: prefixParts + orgId + userId + memId = prefixParts + 3
    if (parts.length === prefixParts + 3) {
      return parts[prefixParts] ?? null;
    }
    return null;
  }
}

// Default STM configuration
export const DEFAULT_STM_CONFIG: StmConfig = {
  defaultTtl: 86400, // 24 hours
  maxTtl: 604800, // 7 days
  minTtl: 60, // 1 minute
  keyPrefix: 'memory:stm',
};
