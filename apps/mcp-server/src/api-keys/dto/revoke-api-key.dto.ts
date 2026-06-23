import { apiKeyIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

export const revokeApiKeyToolSchema = z
  .object({
    userId: userIdSchema,
    keyId: apiKeyIdSchema,
  })
  .strict();

export type RevokeApiKeyToolInput = z.infer<typeof revokeApiKeyToolSchema>;
