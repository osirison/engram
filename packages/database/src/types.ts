import { z } from 'zod';

// Memory type enum
export const MemoryType = {
  SHORT_TERM: 'short-term',
  LONG_TERM: 'long-term',
} as const;

export type MemoryTypeValues = typeof MemoryType[keyof typeof MemoryType];

// Core Memory interface (matches Prisma generated types)
export interface Memory {
  id: string;
  userId: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  tags: string[];
  type: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
}

// Memory creation input interface
export interface CreateMemoryInput {
  userId: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  type: MemoryTypeValues;
  expiresAt?: Date;
}

// Memory update input interface
export interface UpdateMemoryInput {
  content?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  type?: MemoryTypeValues;
  expiresAt?: Date;
}

// Zod validation schemas

// Memory type validation
export const memoryTypeSchema = z.enum(['short-term', 'long-term']);

// Content validation (max 10KB = 10,240 characters)
export const memoryContentSchema = z
  .string()
  .min(1, 'Content cannot be empty')
  .max(10240, 'Content cannot exceed 10KB (10,240 characters)');

// Metadata validation (optional JSON object)
export const memoryMetadataSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .nullable();

// Tags validation (array of strings, max 50 tags, each max 100 chars)
export const memoryTagsSchema = z
  .array(
    z.string().min(1, 'Tag cannot be empty').max(100, 'Tag cannot exceed 100 characters')
  )
  .max(50, 'Cannot have more than 50 tags')
  .optional()
  .default([]);

// User ID validation
export const userIdSchema = z.string().cuid('Invalid user ID format');

// Memory ID validation
export const memoryIdSchema = z.string().cuid('Invalid memory ID format');

// TTL validation for short-term memories (in seconds)
export const ttlSchema = z
  .number()
  .int('TTL must be an integer')
  .min(60, 'TTL must be at least 1 minute (60 seconds)')
  .max(604800, 'TTL cannot exceed 7 days (604800 seconds)')
  .optional();

// Create memory validation schema
export const createMemorySchema = z.object({
  userId: userIdSchema,
  content: memoryContentSchema,
  metadata: memoryMetadataSchema,
  tags: memoryTagsSchema,
  type: memoryTypeSchema,
  expiresAt: z.date().optional(),
});

// Update memory validation schema
export const updateMemorySchema = z.object({
  content: memoryContentSchema.optional(),
  metadata: memoryMetadataSchema,
  tags: memoryTagsSchema,
  type: memoryTypeSchema.optional(),
  expiresAt: z.date().optional(),
});

// Memory query options schema
export const memoryQueryOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  cursor: z.string().cuid().optional(),
  tags: z.array(z.string()).optional(),
  type: memoryTypeSchema.optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  search: z.string().max(500).optional(),
});

// Pagination result interface
export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

// Type exports for validation results
export type CreateMemoryData = z.infer<typeof createMemorySchema>;
export type UpdateMemoryData = z.infer<typeof updateMemorySchema>;
export type MemoryQueryOptions = z.infer<typeof memoryQueryOptionsSchema>;

// Validation helper functions
export const validateCreateMemory = (data: unknown): CreateMemoryData => {
  return createMemorySchema.parse(data);
};

export const validateUpdateMemory = (data: unknown): UpdateMemoryData => {
  return updateMemorySchema.parse(data);
};

export const validateMemoryQueryOptions = (data: unknown): MemoryQueryOptions => {
  return memoryQueryOptionsSchema.parse(data);
};

export const validateUserId = (userId: unknown): string => {
  return userIdSchema.parse(userId);
};

export const validateMemoryId = (memoryId: unknown): string => {
  return memoryIdSchema.parse(memoryId);
};

export const validateTtl = (ttl: unknown): number | undefined => {
  return ttlSchema.parse(ttl);
};

// Custom error types for memory operations
export class MemoryValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'MemoryValidationError';
  }
}

export class MemoryNotFoundError extends Error {
  constructor(memoryId: string) {
    super(`Memory with ID ${memoryId} not found`);
    this.name = 'MemoryNotFoundError';
  }
}

export class MemoryQuotaExceededError extends Error {
  constructor(userId: string, limit: number) {
    super(`Memory quota exceeded for user ${userId}. Limit: ${limit}`);
    this.name = 'MemoryQuotaExceededError';
  }
}