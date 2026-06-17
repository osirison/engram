import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input schema for the `reflect` MCP tool.
 *
 * Synthesises structured insights across all memories that are semantically
 * relevant to a query.  Returns a plain-text summary together with the source
 * memory IDs so the caller can trace the reasoning back to individual records.
 */
export const reflectToolSchema = z
  .object({
    userId: userIdSchema,
    /** The theme, topic, or question to reflect on */
    query: z
      .string()
      .min(1, 'Query cannot be empty')
      .max(2048, 'Query cannot exceed 2048 characters'),
    /** Maximum number of source memories to draw from (default 10, max 30) */
    limit: z.number().int().min(1).max(30).optional().default(10),
    /** Minimum similarity score for a memory to be included [0–1] */
    minScore: z.number().min(0).max(1).optional().default(0.5),
    /** Optional scope filter (e.g. 'work', 'personal') */
    scope: z.string().max(256).optional(),
    /** Optional tag filter */
    tags: z.array(z.string()).max(20).optional(),
  })
  .strict();

export type ReflectToolInput = z.infer<typeof reflectToolSchema>;
