import { userIdSchema } from '@engram/database';
import { z } from 'zod';

const CHUNK_CHAR_LIMIT = 10240;

export const ingestConversationToolSchema = z
  .object({
    userId: userIdSchema,
    /**
     * Ordered list of conversation turns to ingest.
     * Each turn is chunked by content; turns longer than 10 KB are split at
     * sentence/paragraph boundaries so no individual memory exceeds the limit.
     */
    turns: z
      .array(
        z
          .object({
            role: z.string().min(1).max(100),
            content: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    tags: z.array(z.string().min(1).max(100)).max(50).optional().default([]),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /**
     * Max concurrent `remember` calls.  Controls embedding-service back-pressure.
     * Default 5 keeps throughput high without saturating the embedding API.
     */
    concurrency: z.coerce.number().int().min(1).max(10).optional().default(5),
  })
  .strict();

export type IngestConversationToolInput = z.infer<
  typeof ingestConversationToolSchema
>;

export const INGEST_CHUNK_CHAR_LIMIT = CHUNK_CHAR_LIMIT;
