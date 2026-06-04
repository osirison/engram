import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input schema for the `recall` MCP tool.
 *
 * Performs semantic (vector) recall over a user's long-term memories.
 */
export const recallToolSchema = z.object({
  userId: userIdSchema,
  query: z
    .string()
    .min(1, 'Query cannot be empty')
    .max(2048, 'Query cannot exceed 2048 characters'),
  limit: z.number().int().min(1).max(50).optional().default(10),
  scope: z.string().max(256).optional(),
  tags: z.array(z.string()).max(50).optional(),
});

export type RecallToolInput = z.infer<typeof recallToolSchema>;
