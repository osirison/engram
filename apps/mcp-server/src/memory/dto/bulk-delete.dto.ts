import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input for `bulk_delete_memories` (WP2 T6/D9). One MCP call deletes up to 100
 * memories server-side with a per-item report — cheaper and safer than a
 * client-side fan-out of N `delete_memory` calls (rate limits, round-trips, and
 * partial-failure aggregation all belong server-side).
 */
export const bulkDeleteToolSchema = z
  .object({
    userId: userIdSchema,
    memoryIds: z.array(memoryIdSchema).min(1).max(100),
    /** Optional namespace; scope isolation applies to every id in the batch. */
    scope: z.string().min(1).max(256).optional(),
    /** Untrusted display label recorded on each audit row (WP2 T5). */
    actorLabel: z.string().max(256).optional(),
  })
  .strict();

export type BulkDeleteToolInput = z.infer<typeof bulkDeleteToolSchema>;
