---
title: MCP tools
description: Every MCP tool the Engram server registers, with its auth mode and required scope.
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Engram registers **27 MCP tools**. Availability is further
narrowed by the active deployment profile (the queue/reindex maintenance
tools require the enterprise profile).

| Tool | Auth | Scope | Description |
| ---- | ---- | ----- | ----------- |
| [`ping`](./ping) | `public` | — | Test connectivity to ENGRAM server |
| [`create_memory`](./create-memory) | `identity` | `memories:write` | Create a new memory in short-term or long-term storage |
| [`get_memory`](./get-memory) | `identity` | `memories:read` | Retrieve memory by ID |
| [`list_memories`](./list-memories) | `identity` | `memories:read` | List memories with pagination and filtering |
| [`update_memory`](./update-memory) | `identity` | `memories:write` | Update an existing memory. expectedVersion is required (optimistic concurrency): pass the version returned by get_memory or a prior read. Blind updates are rejected, and a stale version fails with a CONFLICT error — re-read the memory and retry with the fresh version. |
| [`delete_memory`](./delete-memory) | `identity` | `memories:delete` | Delete memory by ID |
| [`bulk_delete_memories`](./bulk-delete-memories) | `identity` | `memories:delete` | Delete up to 100 memories in a single call, returning a per-item report of deleted ids and failures. STM/LTM routing and scope isolation are inherited per id. |
| [`promote_memory`](./promote-memory) | `identity` | `memories:write` | Promote short-term memory to long-term storage |
| [`reembed_memory`](./reembed-memory) | `identity` | `memories:write` | Regenerate the vector for a long-term memory's current content and clear its embeddingStale flag. Repairs recall drift left by a content edit made while the embeddings provider was unavailable. |
| [`restore_memory`](./restore-memory) | `identity` | `memories:write` | Recreate a hard-deleted memory from its most recent delete audit snapshot, preserving its original id. Requires the audit trail. |
| [`get_memory_audit`](./get-memory-audit) | `identity` | `memories:read` | Read the append-only audit history (update/delete/promote/reembed/restore) for a memory, newest first. |
| [`recall`](./recall) | `identity` | `memories:read` | Semantically recall the most relevant long-term memories for a natural-language query |
| [`export_memories`](./export-memories) | `identity` | `memories:read` | Export a user's memories as an Obsidian-compatible markdown vault (YAML frontmatter + [[wikilinks]] preserving inter-memory relationships). Bounded exports return documents + manifest inline; larger exports return a server path reference. |
| [`import_agent_memory`](./import-agent-memory) | `admin` | — | Import agent memory files (Claude/Copilot/Cursor/Codex/Gemini/markdown) from a server-side path into long-term memory, preserving inter-memory links. Admin-gated; idempotent; supports dryRun and a secrets policy. |
| [`reindex_memories`](./reindex-memories) | `admin` | — | Rebuild the vector store from Postgres (admin/maintenance). Backfills embeddings for one user or all users; idempotent and cursor-resumable |
| [`queue_reindex_memories`](./queue-reindex-memories) | `admin` | — | Queue asynchronous vector reindexing with persisted progress and resumability cursor |
| [`get_reindex_status`](./get-reindex-status) | `admin` | — | Get status and progress for a queued reindex job (queued/running/completed/failed) |
| [`cancel_reindex_job`](./cancel-reindex-job) | `admin` | — | Cancel a queued/running reindex job and preserve progress cursor |
| [`retry_reindex_job`](./retry-reindex-job) | `admin` | — | Retry a failed/cancelled reindex job from its last persisted cursor |
| [`consolidate_memories`](./consolidate-memories) | `admin` | — | Trigger a synchronous STM→LTM consolidation pass (admin). Promotes short-term memories that meet the access-count threshold into long-term storage. |
| [`remember`](./remember) | `identity` | `memories:write` | Smart create: auto-detects short-term vs long-term storage from content heuristics, deduplicates against existing memories, and returns the stored memory with routing metadata. |
| [`forget`](./forget) | `identity` | `memories:delete` | Smart delete: find memories by natural-language concept and optionally delete them. Dry-run by default — pass confirm=true to execute deletion. |
| [`reflect`](./reflect) | `identity` | `memories:read` | Synthesise structured insights across all memories semantically relevant to a query. Returns a plain-text summary, extracted themes, source memory IDs, and date range. |
| [`compress_context`](./compress-context) | `identity` | `memories:read` | Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget. |
| [`load_context`](./load-context) | `identity` | `memories:read` | Load a session-priming context block by blending the most recent memories with the highest-importance memories. Ideal for injecting into a session-opening prompt. |
| [`ingest_conversation`](./ingest-conversation) | `identity` | `memories:write` | Bulk-ingest a conversation as per-turn long-term memories. Handles chunking for large turns, controls embedding back-pressure via concurrency, and is idempotent: re-submitting the same conversation returns the existing memory IDs. |
| [`prompt_context`](./prompt-context) | `identity` | `memories:read` | Assemble a token-budgeted context block from memories most relevant to a query. Greedy-packs ranked memories within the token budget (1 token ≈ 4 chars). Returns the formatted block plus token accounting metadata. |
