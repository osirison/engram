import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input for `restore_memory` (WP2 T5/G5): recreate a hard-deleted memory from the
 * newest `delete` audit snapshot, preserving its original id.
 */
export const restoreMemoryToolSchema = z
  .object({
    userId: userIdSchema,
    memoryId: memoryIdSchema,
    /** Untrusted display label recorded on the restore audit row. */
    actorLabel: z.string().max(256).optional(),
  })
  .strict();

export type RestoreMemoryToolInput = z.infer<typeof restoreMemoryToolSchema>;

/**
 * Input for `get_memory_audit` (WP2 T5): read the audit history for a memory,
 * newest first.
 */
export const getMemoryAuditToolSchema = z
  .object({
    userId: userIdSchema,
    memoryId: memoryIdSchema,
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  })
  .strict();

export type GetMemoryAuditToolInput = z.infer<typeof getMemoryAuditToolSchema>;
