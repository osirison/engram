import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input schema for the `consolidate_corpus` MCP tool (G3-T2).
 *
 * Clusters NEAR-duplicate long-term memories in the
 * `[MEMORY_CONSOLIDATION_MERGE_THRESHOLD, MEMORY_DUPLICATE_THRESHOLD)`
 * similarity band, collapses each cluster onto one canonical row, and marks
 * the rest superseded. NOT `consolidate_memories` — that tool is the
 * unrelated STM→LTM promotion pass.
 *
 * REVIEW GATE (pinned Decision 3): `dryRun` defaults to TRUE, so calling the
 * tool without it reports would-be merges and mutates absolutely nothing.
 */
export const consolidateCorpusToolSchema = z
  .object({
    /** Admin authorization token; must match MCP_ADMIN_TOKEN. */
    adminToken: z.string().min(16, 'adminToken must be at least 16 chars'),
    /** Restrict the pass to a single user. Omit to scan every user. */
    userId: userIdSchema.optional(),
    /** Restrict the pass to one namespace scope (memories only ever cluster within their own scope regardless). */
    scope: z.string().min(1).max(256).optional(),
    /** Report without mutating. DEFAULTS TO TRUE — pass `dryRun: false` explicitly to merge. */
    dryRun: z.boolean().optional().default(true),
    /** Stop after scanning at most this many seed rows (pair with `cursor` for chunked runs). */
    limit: z.coerce.number().int().min(1).optional(),
    /** Resume from a previously returned cursor. */
    cursor: z.string().optional(),
  })
  .strict();

export type ConsolidateCorpusToolInput = z.infer<
  typeof consolidateCorpusToolSchema
>;
