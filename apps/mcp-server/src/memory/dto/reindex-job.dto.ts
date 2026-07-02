import { z } from 'zod';
import { reindexToolSchema } from './reindex.dto';

/**
 * Input schema for queued reindexing.
 *
 * Same options as `reindex_memories`, but runs asynchronously and returns a
 * job id that can be polled for progress.
 */
export const reindexQueueToolSchema = reindexToolSchema;

export type ReindexQueueToolInput = z.infer<typeof reindexQueueToolSchema>;

/** Input schema for polling a queued reindex job. */
export const reindexStatusToolSchema = z
  .object({
    adminToken: z.string().min(16, 'adminToken must be at least 16 chars'),
    jobId: z.uuid('jobId must be a UUID'),
  })
  .strict();

export type ReindexStatusToolInput = z.infer<typeof reindexStatusToolSchema>;

/** Input schema for cancelling a queued/running reindex job. */
export const reindexCancelToolSchema = z
  .object({
    adminToken: z.string().min(16, 'adminToken must be at least 16 chars'),
    jobId: z.uuid('jobId must be a UUID'),
  })
  .strict();

export type ReindexCancelToolInput = z.infer<typeof reindexCancelToolSchema>;

/** Input schema for retrying a failed or cancelled reindex job. */
export const reindexRetryToolSchema = z
  .object({
    adminToken: z.string().min(16, 'adminToken must be at least 16 chars'),
    jobId: z.uuid('jobId must be a UUID'),
  })
  .strict();

export type ReindexRetryToolInput = z.infer<typeof reindexRetryToolSchema>;
