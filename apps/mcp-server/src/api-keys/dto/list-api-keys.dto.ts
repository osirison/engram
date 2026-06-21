import { userIdSchema } from '@engram/database';
import { z } from 'zod';

export const listApiKeysToolSchema = z
  .object({
    userId: userIdSchema,
  })
  .strict();

export type ListApiKeysToolInput = z.infer<typeof listApiKeysToolSchema>;
