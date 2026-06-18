import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input schema for the `compress_context` MCP tool.
 *
 * Retrieves the most relevant memories for a query and formats them into a
 * compact, context-window-ready block with per-entry truncation to fit the
 * requested token budget.
 */
export const compressContextToolSchema = z
  .object({
    userId: userIdSchema,
    /** Query used to retrieve the most relevant memories */
    query: z
      .string()
      .min(1, 'Query cannot be empty')
      .max(2048, 'Query cannot exceed 2048 characters'),
    /** Maximum memories to retrieve (default 10, max 30) */
    limit: z.coerce.number().int().min(1).max(30).optional().default(10),
    /**
     * Approximate character budget for the entire context block.
     * Individual memory snippets will be truncated to fit.
     * Default 4000 chars (~1000 tokens at 4 chars/token).
     */
    maxChars: z.coerce
      .number()
      .int()
      .min(100)
      .max(32000)
      .optional()
      .default(4000),
    /** Minimum similarity score [0–1] */
    minScore: z.coerce.number().min(0).max(1).optional().default(0.5),
    /** Optional scope filter */
    scope: z.string().max(256).optional(),
  })
  .strict();

export type CompressContextToolInput = z.infer<
  typeof compressContextToolSchema
>;

/**
 * Input schema for the `load_context` MCP tool.
 *
 * Returns a token-budgeted context block suitable for injection into a session
 * opening prompt.  Blends the most recent memories with the highest-importance
 * memories so the agent is primed with both fresh context and durable knowledge.
 */
export const loadContextToolSchema = z
  .object({
    userId: userIdSchema,
    /**
     * Approximate character budget for the entire context block.
     * Default 6000 chars (~1500 tokens).
     */
    maxChars: z.coerce
      .number()
      .int()
      .min(100)
      .max(32000)
      .optional()
      .default(6000),
    /** Maximum recent memories to include (default 5, max 20) */
    recentLimit: z.coerce.number().int().min(0).max(20).optional().default(5),
    /** Maximum high-importance memories to include (default 10, max 30) */
    importantLimit: z.coerce
      .number()
      .int()
      .min(0)
      .max(30)
      .optional()
      .default(10),
    /** Optional scope filter */
    scope: z.string().max(256).optional(),
    /** Optional tag filter */
    tags: z.array(z.string()).max(20).optional(),
  })
  .strict();

export type LoadContextToolInput = z.infer<typeof loadContextToolSchema>;
