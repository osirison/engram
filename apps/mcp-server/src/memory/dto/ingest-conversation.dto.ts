import { userIdSchema } from '@engram/database';
import { z } from 'zod';
import {
  INGEST_CHUNK_CHAR_LIMIT as CHUNK_CHAR_LIMIT,
  INGEST_MAX_CHUNKS,
  countConversationChunks,
} from '../conversation-chunking';

export const ingestConversationToolSchema = z
  .object({
    userId: userIdSchema,
    /**
     * Ordered list of conversation turns to ingest.
     * Each turn is chunked by content; turns longer than 10 KB are split at
     * double-newline (paragraph) boundaries, with a hard character-cut fallback,
     * so no individual stored memory exceeds the 10 KB limit.
     *
     * The whole request is additionally capped at {@link INGEST_MAX_CHUNKS}
     * total chunks: every chunk costs one `remember()` call (embedding +
     * vector search + DB write), so an uncapped request could amplify into
     * hundreds of downstream operations (#204). Requests above the cap are
     * rejected — split the conversation into smaller ingests.
     */
    turns: z
      .array(
        z
          .object({
            role: z.string().min(1).max(100),
            content: z.string().min(1).max(1_048_576),
          })
          .strict(),
      )
      .min(1)
      .max(500)
      .superRefine((turns, ctx) => {
        const chunkCount = countConversationChunks(turns);
        if (chunkCount > INGEST_MAX_CHUNKS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `conversation expands to ${chunkCount} chunks, exceeding the maximum of ` +
              `${INGEST_MAX_CHUNKS} per request; split the ingest into smaller batches`,
          });
        }
      }),
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
export { INGEST_MAX_CHUNKS };
