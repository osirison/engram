import { memoryIdSchema, userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Client-facing rejection for a blind update (G4-T2, docs/concurrency-policy.md).
 * Conflict-class on purpose: it surfaces through the same `CONFLICT:` marker the
 * stale-version path uses, and tells the agent exactly how to recover.
 */
export const EXPECTED_VERSION_REQUIRED_MESSAGE =
  'CONFLICT: update_memory requires expectedVersion (the current version of the memory). ' +
  'Call get_memory - or reuse the version from a prior read - then retry with that version.';

export const updateMemoryToolSchema = z
  .object({
    userId: userIdSchema,
    memoryId: memoryIdSchema,
    content: z
      .string()
      .min(1, 'Content cannot be empty')
      .max(10240, 'Content cannot exceed 10KB')
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
    ttl: z.coerce.number().int().min(60).max(604800).optional(),
    /**
     * Optional namespace used to locate the memory. Scope is immutable, so this
     * filters which memory is updated rather than changing its scope.
     */
    scope: z.string().min(1).max(256).optional(),
    /**
     * Optimistic-concurrency guard (WP2 T4 / G4-T2). REQUIRED: the update is
     * applied only if the memory is still at this version; a stale version fails
     * with a `CONFLICT:` error. Blind (versionless) agent updates are rejected —
     * per the concurrent-writer policy ADR (docs/concurrency-policy.md), the
     * caller must re-read the memory (get_memory) and retry with the version it
     * read. Applies to both tiers (LTM CAS, STM read-compare-set).
     */
    expectedVersion: z.coerce
      .number({ error: EXPECTED_VERSION_REQUIRED_MESSAGE })
      .int()
      .min(1),
    /** Untrusted display label recorded on the audit row (WP2 T5). */
    actorLabel: z.string().max(256).optional(),
  })
  .strict();

export type UpdateMemoryToolInput = z.infer<typeof updateMemoryToolSchema>;
