import { z } from 'zod';

export const getMemoryToolSchema = z.object({
  userId: z.string().cuid('Invalid user ID format'),
  memoryId: z.string().cuid('Invalid memory ID format'),
});

export type GetMemoryToolInput = z.infer<typeof getMemoryToolSchema>;
