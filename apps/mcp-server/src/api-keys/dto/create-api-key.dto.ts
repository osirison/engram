import { apiKeyScopeSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

export const createApiKeyToolSchema = z
  .object({
    userId: userIdSchema,
    name: z
      .string()
      .min(1, 'Name cannot be empty')
      .max(100, 'Name cannot exceed 100 characters'),
    scopes: z
      .array(apiKeyScopeSchema)
      .min(1, 'At least one scope is required')
      .max(10, 'Cannot assign more than 10 scopes'),
    expiresInDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(3650)
      .optional()
      .describe('Key lifetime in days (omit for no expiry)'),
  })
  .strict();

export type CreateApiKeyToolInput = z.infer<typeof createApiKeyToolSchema>;
