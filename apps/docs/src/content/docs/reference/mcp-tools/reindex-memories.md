---
title: "reindex_memories"
description: "Rebuild the vector store from Postgres (admin/maintenance). Backfills embeddings for one user or all users; idempotent and cursor-resumable"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Rebuild the vector store from Postgres (admin/maintenance). Backfills embeddings for one user or all users; idempotent and cursor-resumable

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

## Example

```json
{
  "name": "reindex_memories",
  "arguments": {
    "adminToken": "<adminToken>"
  }
}
```
