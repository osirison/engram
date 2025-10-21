import { z } from 'zod';
import {
  Memory,
  memoryContentSchema,
  memoryMetadataSchema,
  memoryTagsSchema,
  userIdSchema,
} from '@engram/database';

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

// Zod validation schemas

// Create LTM memory schema
export const createLtmMemorySchema = z.object({
  userId: userIdSchema,
  content: memoryContentSchema,
  metadata: memoryMetadataSchema,
  tags: memoryTagsSchema,
});

// Update LTM memory schema
export const updateLtmMemorySchema = z.object({
  content: memoryContentSchema.optional(),
  metadata: memoryMetadataSchema,
  tags: memoryTagsSchema,
});

// LTM query options schema
export const ltmQueryOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().cuid().optional(),
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