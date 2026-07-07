import type { z } from 'zod';
import type { ToolAuthMode } from '@engram/core';

import { createMemoryToolSchema } from './dto/create-memory.dto';
import { getMemoryToolSchema } from './dto/get-memory.dto';
import { listMemoriesToolSchema } from './dto/list-memories.dto';
import { updateMemoryToolSchema } from './dto/update-memory.dto';
import { recallToolSchema } from './dto/recall.dto';
import { reembedMemoryToolSchema } from './dto/reembed.dto';
import { mutateByIdToolSchema } from './dto/mutate-by-id.dto';
import { bulkDeleteToolSchema } from './dto/bulk-delete.dto';
import {
  restoreMemoryToolSchema,
  getMemoryAuditToolSchema,
} from './dto/audit.dto';
import { reindexToolSchema } from './dto/reindex.dto';
import {
  reindexQueueToolSchema,
  reindexStatusToolSchema,
  reindexCancelToolSchema,
  reindexRetryToolSchema,
} from './dto/reindex-job.dto';
import { consolidateToolSchema } from './dto/consolidate.dto';
import { rememberToolSchema } from './dto/remember.dto';
import { forgetToolSchema } from './dto/forget.dto';
import { reflectToolSchema } from './dto/reflect.dto';
import {
  compressContextToolSchema,
  loadContextToolSchema,
  promptContextToolSchema,
} from './dto/context.dto';
import { ingestConversationToolSchema } from './dto/ingest-conversation.dto';
import { exportToolSchema } from './dto/export.dto';
import { importAgentMemoryToolSchema } from './dto/import-agent-memory.dto';

/**
 * Static metadata for one MCP tool: everything except the bound handler.
 *
 * This is the single source of truth for the tool surface. {@link
 * MemoryController.getMcpTools} attaches handlers by name and applies
 * availability/profile filtering; the docs generator (`scripts/gen-mcp-tools.mjs`)
 * reads this same array so the reference can never drift from what the server
 * registers.
 */
export interface ToolManifestEntry {
  name: string;
  description: string;
  /**
   * Always a `ZodObject` (all tool schemas are `z.object(...).strict()`). The
   * docs generator emits a parameter table from its shape and the wiring spec
   * asserts it, so the type is narrowed here to keep that contract explicit.
   */
  inputSchema: z.ZodObject;
  /** Defaults to `identity` when omitted. */
  auth?: ToolAuthMode;
  /** Scope an authenticated principal must hold (the `admin` scope satisfies any). */
  requiredScope?: string;
  /** Whether an admin-scoped key may act on another tenant by passing an explicit userId. */
  delegable?: boolean;
}

/**
 * The full, unfiltered MCP tool manifest. Order is the canonical tool order.
 * Scope requirements are attached inline (previously the `scopeByTool` map);
 * `memories:read` for reads, `memories:write` for mutations, `memories:delete`
 * for deletions. Admin maintenance tools gate on `MCP_ADMIN_TOKEN` via
 * `auth: 'admin'` and intentionally carry no scope.
 */
export const TOOL_MANIFEST: readonly ToolManifestEntry[] = [
  {
    name: 'create_memory',
    description: 'Create a new memory in short-term or long-term storage',
    inputSchema: createMemoryToolSchema,
    requiredScope: 'memories:write',
  },
  {
    name: 'get_memory',
    description: 'Retrieve memory by ID',
    inputSchema: getMemoryToolSchema,
    delegable: true,
    requiredScope: 'memories:read',
  },
  {
    name: 'list_memories',
    description: 'List memories with pagination and filtering',
    inputSchema: listMemoriesToolSchema,
    delegable: true,
    requiredScope: 'memories:read',
  },
  {
    name: 'update_memory',
    description: 'Update existing memory',
    inputSchema: updateMemoryToolSchema,
    delegable: true,
    requiredScope: 'memories:write',
  },
  {
    name: 'delete_memory',
    description: 'Delete memory by ID',
    inputSchema: mutateByIdToolSchema,
    delegable: true,
    requiredScope: 'memories:delete',
  },
  {
    name: 'bulk_delete_memories',
    description:
      'Delete up to 100 memories in a single call, returning a per-item report of deleted ids and failures. STM/LTM routing and scope isolation are inherited per id.',
    inputSchema: bulkDeleteToolSchema,
    delegable: true,
    requiredScope: 'memories:delete',
  },
  {
    name: 'promote_memory',
    description: 'Promote short-term memory to long-term storage',
    inputSchema: mutateByIdToolSchema,
    delegable: true,
    requiredScope: 'memories:write',
  },
  {
    name: 'reembed_memory',
    description:
      "Regenerate the vector for a long-term memory's current content and clear its embeddingStale flag. Repairs recall drift left by a content edit made while the embeddings provider was unavailable.",
    inputSchema: reembedMemoryToolSchema,
    delegable: true,
    requiredScope: 'memories:write',
  },
  {
    name: 'restore_memory',
    description:
      'Recreate a hard-deleted memory from its most recent delete audit snapshot, preserving its original id. Requires the audit trail.',
    inputSchema: restoreMemoryToolSchema,
    delegable: true,
    requiredScope: 'memories:write',
  },
  {
    name: 'get_memory_audit',
    description:
      'Read the append-only audit history (update/delete/promote/reembed/restore) for a memory, newest first.',
    inputSchema: getMemoryAuditToolSchema,
    delegable: true,
    requiredScope: 'memories:read',
  },
  {
    name: 'recall',
    description:
      'Semantically recall the most relevant long-term memories for a natural-language query',
    inputSchema: recallToolSchema,
    delegable: true,
    requiredScope: 'memories:read',
  },
  {
    name: 'export_memories',
    description:
      "Export a user's memories as an Obsidian-compatible markdown vault (YAML frontmatter + [[wikilinks]] preserving inter-memory relationships). Bounded exports return documents + manifest inline; larger exports return a server path reference.",
    inputSchema: exportToolSchema,
    delegable: true,
    requiredScope: 'memories:read',
  },
  {
    name: 'import_agent_memory',
    description:
      'Import agent memory files (Claude/Copilot/Cursor/Codex/Gemini/markdown) from a server-side path into long-term memory, preserving inter-memory links. Admin-gated; idempotent; supports dryRun and a secrets policy.',
    inputSchema: importAgentMemoryToolSchema,
    auth: 'admin',
  },
  {
    name: 'reindex_memories',
    description:
      'Rebuild the vector store from Postgres (admin/maintenance). Backfills embeddings for one user or all users; idempotent and cursor-resumable',
    inputSchema: reindexToolSchema,
    auth: 'admin',
  },
  {
    name: 'queue_reindex_memories',
    description:
      'Queue asynchronous vector reindexing with persisted progress and resumability cursor',
    inputSchema: reindexQueueToolSchema,
    auth: 'admin',
  },
  {
    name: 'get_reindex_status',
    description:
      'Get status and progress for a queued reindex job (queued/running/completed/failed)',
    inputSchema: reindexStatusToolSchema,
    auth: 'admin',
  },
  {
    name: 'cancel_reindex_job',
    description:
      'Cancel a queued/running reindex job and preserve progress cursor',
    inputSchema: reindexCancelToolSchema,
    auth: 'admin',
  },
  {
    name: 'retry_reindex_job',
    description:
      'Retry a failed/cancelled reindex job from its last persisted cursor',
    inputSchema: reindexRetryToolSchema,
    auth: 'admin',
  },
  {
    name: 'consolidate_memories',
    description:
      'Trigger a synchronous STM→LTM consolidation pass (admin). Promotes short-term memories that meet the access-count threshold into long-term storage.',
    inputSchema: consolidateToolSchema,
    auth: 'admin',
  },
  {
    name: 'remember',
    description:
      'Smart create: auto-detects short-term vs long-term storage from content heuristics, deduplicates against existing memories, and returns the stored memory with routing metadata.',
    inputSchema: rememberToolSchema,
    requiredScope: 'memories:write',
  },
  {
    name: 'forget',
    description:
      'Smart delete: find memories by natural-language concept and optionally delete them. Dry-run by default — pass confirm=true to execute deletion.',
    inputSchema: forgetToolSchema,
    requiredScope: 'memories:delete',
  },
  {
    name: 'reflect',
    description:
      'Synthesise structured insights across all memories semantically relevant to a query. Returns a plain-text summary, extracted themes, source memory IDs, and date range.',
    inputSchema: reflectToolSchema,
    requiredScope: 'memories:read',
  },
  {
    name: 'compress_context',
    description:
      'Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget.',
    inputSchema: compressContextToolSchema,
    requiredScope: 'memories:read',
  },
  {
    name: 'load_context',
    description:
      'Load a session-priming context block by blending the most recent memories with the highest-importance memories. Ideal for injecting into a session-opening prompt.',
    inputSchema: loadContextToolSchema,
    requiredScope: 'memories:read',
  },
  {
    name: 'ingest_conversation',
    description:
      'Bulk-ingest a conversation as per-turn long-term memories. Handles chunking for large turns, controls embedding back-pressure via concurrency, and is idempotent: re-submitting the same conversation returns the existing memory IDs.',
    inputSchema: ingestConversationToolSchema,
    requiredScope: 'memories:write',
  },
  {
    name: 'prompt_context',
    description:
      'Assemble a token-budgeted context block from memories most relevant to a query. Greedy-packs ranked memories within the token budget (1 token ≈ 4 chars). Returns the formatted block plus token accounting metadata.',
    inputSchema: promptContextToolSchema,
    requiredScope: 'memories:read',
  },
];
