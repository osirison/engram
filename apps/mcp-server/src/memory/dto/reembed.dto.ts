import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input for the `reembed_memory` tool (WP2 T7): regenerate the vector for a
 * memory's current content and clear its `embeddingStale` flag. Shaped like
 * `get_memory` — it locates a single memory and repairs it in place.
 */
export const reembedMemoryToolSchema = z
  .object({
    userId: userIdSchema,
    memoryId: memoryIdSchema,
    /** Optional namespace used to locate the memory (scope isolation). */
    scope: z.string().min(1).max(256).optional(),
  })
  .strict();

export type ReembedMemoryToolInput = z.infer<typeof reembedMemoryToolSchema>;
