import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input schema for the `import_agent_memory` MCP tool (WP4 T13).
 *
 * Reads a SERVER-SIDE path with the selected source adapter and bulk-writes
 * long-term memories + links — hence admin-gated. Idempotent (re-runs skip
 * unchanged sources); `dryRun` reports what would happen and writes nothing.
 */
export const importAgentMemoryToolSchema = z
  .object({
    /** Admin authorization token; must match MCP_ADMIN_TOKEN. */
    adminToken: z.string().min(16, 'adminToken must be at least 16 chars'),
    /** Which tool's on-disk format the adapter should parse. */
    source: z.enum([
      'claude-code',
      'copilot',
      'cursor',
      'codex',
      'gemini',
      'markdown',
    ]),
    /** Server-side filesystem path to import from. */
    path: z.string().min(1),
    /** Data owner the memories are written for. */
    userId: userIdSchema,
    /** Dedup/link namespace (default `import`). */
    scope: z.string().min(1).optional(),
    /** Parse + estimate only; persist nothing. */
    dryRun: z.boolean().optional(),
    /** How detected secrets are handled (default `redact`). */
    secretsPolicy: z.enum(['redact', 'flag', 'skip', 'fail']).optional(),
    /** Embed inline during import; false advises a later reindex. */
    embed: z.boolean().optional(),
    /** Opt into H2 chunking for 1-file-1-memory sources (markdown vaults). */
    splitHeadings: z.boolean().optional(),
    /** Include the user-global instruction file (~/.codex, ~/.gemini). */
    includeGlobal: z.boolean().optional(),
  })
  .strict();

export type ImportAgentMemoryToolInput = z.infer<
  typeof importAgentMemoryToolSchema
>;
