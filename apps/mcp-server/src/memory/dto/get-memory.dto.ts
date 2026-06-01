import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

export const getMemoryToolSchema = z.object({
  userId: userIdSchema,
  memoryId: memoryIdSchema,
});

export type GetMemoryToolInput = z.infer<typeof getMemoryToolSchema>;
