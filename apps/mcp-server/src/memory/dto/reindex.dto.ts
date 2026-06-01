import { z } from 'zod';

/**
 * Input schema for the `reindex_memories` MCP tool.
 *
 * Rebuilds the vector store from Postgres (the source of truth). Intended for
 * operators seeding a freshly added vector backend or re-embedding after an
 * embedding-model change. The operation is idempotent and cursor-resumable.
 */
export const reindexToolSchema = z.object({
  /** Admin authorization token; must match MCP_ADMIN_TOKEN. */
  adminToken: z.string().min(16, 'adminToken must be at least 16 chars'),
  /** Restrict the reindex to a single user. Omit to reindex every user. */
  userId: z.string().cuid('Invalid user ID format').optional(),
  /** Memories loaded per page (1-1000). Defaults to 100. */
  batchSize: z.number().int().min(1).max(1000).optional(),
  /** When false, regenerate embeddings for every memory. Defaults to true. */
  reuseExistingEmbeddings: z.boolean().optional(),
  /** Resume from a previously returned cursor. */
  cursor: z.string().optional(),
  /** Stop after processing at most this many memories. */
  maxMemories: z.number().int().min(1).optional(),
});

export type ReindexToolInput = z.infer<typeof reindexToolSchema>;
