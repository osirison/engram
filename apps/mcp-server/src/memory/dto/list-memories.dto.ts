import { cursorIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

// A page cursor is either an LTM id cursor (cuid) or a Redis SCAN cursor
// (non-negative integer string) used when paging the short-term tier. Accepting
// both lets `list_memories(type: 'short-term')` page STM through the same tool
// instead of a bespoke one (WP2 T2/D1).
const listCursorSchema = z.union([
  cursorIdSchema,
  z.string().regex(/^\d+$/, 'Invalid cursor'),
]);

export const listMemoriesToolSchema = z
  .object({
    userId: userIdSchema,
    type: z.enum(['short-term', 'long-term']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    cursor: listCursorSchema.optional(),
    scope: z.string().min(1).max(256).optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().max(500).optional(),
  })
  .strict();

export type ListMemoriesToolInput = z.infer<typeof listMemoriesToolSchema>;
