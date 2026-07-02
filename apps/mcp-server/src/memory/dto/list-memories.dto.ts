import { cursorIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

export const listMemoriesToolSchema = z
  .object({
    userId: userIdSchema,
    type: z.enum(['short-term', 'long-term']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    cursor: cursorIdSchema.optional(),
    scope: z.string().min(1).max(256).optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().max(500).optional(),
  })
  .strict();

export type ListMemoriesToolInput = z.infer<typeof listMemoriesToolSchema>;
