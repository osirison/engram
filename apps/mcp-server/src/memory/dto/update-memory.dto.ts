import { z } from 'zod';

export const updateMemoryToolSchema = z.object({
  userId: z.string().cuid('Invalid user ID format'),
  memoryId: z.string().cuid('Invalid memory ID format'),
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
