import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input schema for the `consolidate_memories` MCP tool.
 *
 * Triggers a synchronous consolidation pass that promotes any STM memories
 * whose access count meets the configured threshold into LTM.
 */
export const consolidateToolSchema = z
  .object({
    /** Admin authorization token; must match MCP_ADMIN_TOKEN. */
    adminToken: z.string().min(16, 'adminToken must be at least 16 chars'),
    /** Restrict the pass to a single user. Omit to scan all users. */
    userId: userIdSchema.optional(),
  })
  .strict();

export type ConsolidateToolInput = z.infer<typeof consolidateToolSchema>;
