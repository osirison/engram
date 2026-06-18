import { userIdSchema } from '@engram/database';
import { z } from 'zod';

export const createMemoryToolSchema = z.object({
  userId: userIdSchema,
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(10240, 'Content cannot exceed 10KB'),
  type: z.enum(['short-term', 'long-term']),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional().default([]),
  ttl: z.coerce.number().int().min(60).max(604800).optional(),
});

export type CreateMemoryToolInput = z.infer<typeof createMemoryToolSchema>;
