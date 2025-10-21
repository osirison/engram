import { z } from 'zod';
import { Memory } from '@engram/database';

// STM-specific configuration
export interface StmConfig {
  defaultTtl: number; // Default TTL in seconds (24 hours)
  maxTtl: number;     // Maximum TTL in seconds (7 days)
  minTtl: number;     // Minimum TTL in seconds (1 minute)
  keyPrefix: string;  // Redis key prefix
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
  offset?: number;
}

// STM Memory (extends base Memory with STM-specific properties)
export interface StmMemory extends Memory {
  type: 'short-term';
  expiresAt: Date; // Always set for STM
  ttl: number;     // Current TTL in seconds
}

// Validation schemas for STM operations

// User ID validation
const userIdSchema = z.string().cuid('Invalid user ID format');

// Content validation (max 10KB = 10,240 characters)
const contentSchema = z
  .string()
  .min(1, 'Content cannot be empty')
  .max(10240, 'Content cannot exceed 10KB (10,240 characters)');

// Metadata validation (optional JSON object)
const metadataSchema = z.record(z.string(), z.unknown()).optional();

// Tags validation (array of strings, max 50 tags, each max 100 chars)
const tagsSchema = z
  .array(
    z.string().min(1, 'Tag cannot be empty').max(100, 'Tag cannot exceed 100 characters')
  )
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
  offset: z.number().int().min(0).optional().default(0),
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
   * Build Redis key for a memory
   */
  buildMemoryKey(userId: string, memoryId: string): string {
    return `${this.prefix}:${userId}:${memoryId}`;
  }

  /**
   * Build Redis key pattern for user memories
   */
  buildUserPattern(userId: string): string {
    return `${this.prefix}:${userId}:*`;
  }

  /**
   * Extract memory ID from Redis key
   */
  extractMemoryId(key: string): string | null {
    const parts = key.split(':');
    const memoryId = parts[parts.length - 1];
    return memoryId && memoryId.length > 0 ? memoryId : null;
  }

  /**
   * Extract user ID from Redis key
   */
  extractUserId(key: string): string | null {
    const parts = key.split(':');
    const userId = parts[parts.length - 2];
    return userId && userId.length > 0 ? userId : null;
  }
}

// Default STM configuration
export const DEFAULT_STM_CONFIG: StmConfig = {
  defaultTtl: 86400,    // 24 hours
  maxTtl: 604800,      // 7 days
  minTtl: 60,          // 1 minute
  keyPrefix: 'memory:stm',
};