---
title: "reindex_memories"
description: "Rebuild the vector store from Postgres (admin/maintenance). Backfills embeddings for one user or all users; idempotent and cursor-resumable. Run it after switching VECTOR_BACKEND, changing the embedding model/provider (set reuseExistingEmbeddings=false and recreate=true so the index is rebuilt at the new dimensionality), or losing/corrupting the vector index. Synchronous — blocks until the pass completes and returns the processed/indexed/skipped/failed summary; prefer queue_reindex_memories for large corpora."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Rebuild the vector store from Postgres (admin/maintenance). Backfills embeddings for one user or all users; idempotent and cursor-resumable. Run it after switching VECTOR_BACKEND, changing the embedding model/provider (set reuseExistingEmbeddings=false and recreate=true so the index is rebuilt at the new dimensionality), or losing/corrupting the vector index. Synchronous — blocks until the pass completes and returns the processed/indexed/skipped/failed summary; prefer queue_reindex_memories for large corpora.

**Auth mode:** `admin`  
**Admin tool:** requires `MCP_ADMIN_TOKEN`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `adminToken` | string | yes | — | — |
| `userId` | string | no | — | — |
| `batchSize` | integer | no | — | — |
| `reuseExistingEmbeddings` | boolean | no | — | — |
| `cursor` | string | no | — | — |
| `maxMemories` | integer | no | — | — |
| `recreate` | boolean | no | — | — |

## Example

```json
{
  "name": "reindex_memories",
  "arguments": {
    "adminToken": "<adminToken>"
  }
}
```
