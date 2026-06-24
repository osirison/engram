import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

export const getMemoryToolSchema = z
  .object({
    userId: userIdSchema,
    memoryId: memoryIdSchema,
    /** Optional namespace; when set, the memory is only returned if it lives in this scope. */
    scope: z.string().min(1).max(256).optional(),
  })
  .strict();

export type GetMemoryToolInput = z.infer<typeof getMemoryToolSchema>;
