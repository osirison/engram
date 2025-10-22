import { z } from 'zod';

export const listMemoriesToolSchema = z.object({
  userId: z.string().cuid('Invalid user ID format'),
  type: z.enum(['short-term', 'long-term']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().cuid().optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().max(500).optional(),
});

export type ListMemoriesToolInput = z.infer<typeof listMemoriesToolSchema>;
