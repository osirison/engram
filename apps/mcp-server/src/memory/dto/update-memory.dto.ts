import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

export const updateMemoryToolSchema = z
  .object({
    userId: userIdSchema,
    memoryId: memoryIdSchema,
    content: z
      .string()
      .min(1, 'Content cannot be empty')
      .max(10240, 'Content cannot exceed 10KB')
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
    ttl: z.coerce.number().int().min(60).max(604800).optional(),
    /**
     * Optional namespace used to locate the memory. Scope is immutable, so this
     * filters which memory is updated rather than changing its scope.
     */
    scope: z.string().min(1).max(256).optional(),
    /**
     * Optimistic-concurrency guard (WP2 T4/G4). When set, the update is applied
     * only if the memory is still at this version; otherwise it fails with a
     * `CONFLICT:` error. Optional so existing agent callers keep last-write-wins.
     */
    expectedVersion: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export type UpdateMemoryToolInput = z.infer<typeof updateMemoryToolSchema>;
