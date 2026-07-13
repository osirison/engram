import { z } from 'zod';

const cuid1IdSchema = z.string().cuid();
const cuid2IdSchema = z.string().cuid2();

const createCompatibleIdSchema = (message: string): z.ZodString =>
  z.string().refine((value) => {
    return cuid1IdSchema.safeParse(value).success || cuid2IdSchema.safeParse(value).success;
  }, message);

// Memory type enum
export const MemoryType = {
  SHORT_TERM: 'short-term',
  LONG_TERM: 'long-term',
} as const;

export type MemoryTypeValues = (typeof MemoryType)[keyof typeof MemoryType];

// Organization roles
export const MembershipRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export type MembershipRoleValues = (typeof MembershipRole)[keyof typeof MembershipRole];

// Core Organization interface
export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

// Core Membership interface
export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

// API key scopes
export const ApiKeyScope = {
  MEMORIES_READ: 'memories:read',
  MEMORIES_WRITE: 'memories:write',
  MEMORIES_DELETE: 'memories:delete',
  ADMIN: 'admin',
} as const;

export type ApiKeyScopeValues = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

// Core ApiKey interface (matches Prisma generated types)
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  userId: string;
  organizationId?: string | null;
  scopes: string[];
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Safe ApiKey (excludes hash, for external responses)
export type SafeApiKey = Omit<ApiKey, 'hash'>;

// Core Memory interface (matches Prisma generated types)
export interface Memory {
  id: string;
  userId: string;
  organizationId?: string | null;
  /** Optional namespace for agent/session/project isolation. */
  scope?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
  tags: string[];
  embedding: number[];
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
export const memoryMetadataSchema = z.record(z.string(), z.unknown()).optional().nullable();

// Tags validation (array of strings, max 50 tags, each max 100 chars)
export const memoryTagsSchema = z
  .array(z.string().min(1, 'Tag cannot be empty').max(100, 'Tag cannot exceed 100 characters'))
  .max(50, 'Cannot have more than 50 tags')
  .optional()
  .default([]);

// API key ID validation
export const apiKeyIdSchema = createCompatibleIdSchema('Invalid API key ID format');

// API key scope validation — derived from ApiKeyScope to keep a single source of truth
export const apiKeyScopeSchema = z.enum(
  Object.values(ApiKeyScope) as [ApiKeyScopeValues, ...ApiKeyScopeValues[]]
);

// User ID validation
export const userIdSchema = createCompatibleIdSchema('Invalid user ID format');

// Memory ID validation. Unlike the other id schemas, memory ids come in THREE
// formats: legacy CUID and CUID2 (LTM rows minted by Prisma) plus UUID — the
// STM tier mints `randomUUID()` ids (memory-stm.service.ts). Rejecting UUIDs
// here would make every by-id MCP tool (get/update/delete/promote/reembed)
// unable to address a short-term memory (found by the #233 e2e prose spec).
const uuidIdSchema = z.string().uuid();
export const memoryIdSchema = z.string().refine((value) => {
  return (
    cuid1IdSchema.safeParse(value).success ||
    cuid2IdSchema.safeParse(value).success ||
    uuidIdSchema.safeParse(value).success
  );
}, 'Invalid memory ID format');

// Cursor validation accepts legacy CUID and new CUID2 values.
export const cursorIdSchema = createCompatibleIdSchema('Invalid cursor ID format');

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
  cursor: cursorIdSchema.optional(),
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
  constructor(
    message: string,
    public field?: string
  ) {
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
