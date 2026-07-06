import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Untrusted display label recorded on an audit row (WP2 T5/D6) — e.g. the web
 * operator's email. It is a label only (never an authorization input) and is
 * injected server-side by the web tRPC layer, overriding anything a browser sent.
 */
export const actorLabelSchema = z.string().max(256).optional();

/**
 * Input for by-id mutations that audit (delete_memory, promote_memory): the
 * get_memory locator plus an optional `actorLabel`. A separate schema keeps the
 * read-only `get_memory` tool's advertised input clean.
 */
export const mutateByIdToolSchema = z
  .object({
    userId: userIdSchema,
    memoryId: memoryIdSchema,
    /** Optional namespace; scope isolation for locating the memory. */
    scope: z.string().min(1).max(256).optional(),
    actorLabel: actorLabelSchema,
  })
  .strict();

export type MutateByIdToolInput = z.infer<typeof mutateByIdToolSchema>;
