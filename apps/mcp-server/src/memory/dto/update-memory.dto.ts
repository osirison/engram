import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

export const updateMemoryToolSchema = z.object({
  userId: userIdSchema,
  memoryId: memoryIdSchema,
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(10240, 'Content cannot exceed 10KB')
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  ttl: z.number().int().min(60).max(604800).optional(),
});

export type UpdateMemoryToolInput = z.infer<typeof updateMemoryToolSchema>;
