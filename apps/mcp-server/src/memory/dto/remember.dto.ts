import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input schema for the `remember` MCP tool.
 *
 * High-level smart create: auto-detects STM vs LTM from `type='auto'`,
 * deduplicates before writing (returns the existing memory ID when the
 * content is too similar to an existing memory).
 */
export const rememberToolSchema = z
  .object({
    userId: userIdSchema,
    content: z
      .string()
      .min(1, 'Content cannot be empty')
      .max(10240, 'Content cannot exceed 10KB'),
    /**
     * 'auto'       — heuristic routing: time-bound / contextual content → STM,
     *                factual / knowledge content → LTM (default)
     * 'short-term' — force STM with optional TTL
     * 'long-term'  — force LTM (permanent until decayed)
     */
    type: z
      .enum(['auto', 'short-term', 'long-term'])
      .optional()
      .default('auto'),
    metadata: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional().default([]),
    /** TTL in seconds; only used when type is 'short-term' or 'auto' routes to STM */
    ttl: z.coerce.number().int().min(60).max(604800).optional(),
    /** Skip duplicate check when true (default false) */
    skipDuplicateCheck: z.boolean().optional().default(false),
  })
  .strict();

export type RememberToolInput = z.infer<typeof rememberToolSchema>;
