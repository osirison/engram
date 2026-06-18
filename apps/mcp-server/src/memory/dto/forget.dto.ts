import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input schema for the `forget` MCP tool.
 *
 * High-level smart delete: finds memories by concept / natural-language query
 * rather than requiring a specific ID.  Safe by default — pass `confirm: true`
 * to execute the deletion, omit it (or pass `false`) to get a dry-run preview.
 */
export const forgetToolSchema = z
  .object({
    userId: userIdSchema,
    /** Natural-language concept or topic to forget (e.g. "my work laptop password") */
    query: z
      .string()
      .min(1, 'Query cannot be empty')
      .max(2048, 'Query cannot exceed 2048 characters'),
    /**
     * Maximum number of candidate memories to return / delete.
     * Capped at 20 to prevent accidental mass deletion.
     */
    limit: z.coerce.number().int().min(1).max(20).optional().default(5),
    /**
     * When false (default), return the list of matched memories without
     * deleting them so the caller can confirm.  Set to true to delete.
     */
    confirm: z.boolean().optional().default(false),
    /** Minimum similarity score [0–1] for a memory to be considered a match */
    minScore: z.coerce.number().min(0).max(1).optional().default(0.6),
  })
  .strict();

export type ForgetToolInput = z.infer<typeof forgetToolSchema>;
