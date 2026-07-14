---
title: "queue_reindex_memories"
description: "Queue an asynchronous vector reindex and return a jobId immediately — the right choice for large corpora or any rebuild you should not block on. Supports the same options as reindex_memories, including recreate for embedding model/dimension changes. Jobs persist progress (with a resume cursor) in Redis and run strictly one at a time. Poll with get_reindex_status; cancel_reindex_job / retry_reindex_job manage the job from its persisted cursor."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Queue an asynchronous vector reindex and return a jobId immediately — the right choice for large corpora or any rebuild you should not block on. Supports the same options as reindex_memories, including recreate for embedding model/dimension changes. Jobs persist progress (with a resume cursor) in Redis and run strictly one at a time. Poll with get_reindex_status; cancel_reindex_job / retry_reindex_job manage the job from its persisted cursor.

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
  "name": "queue_reindex_memories",
  "arguments": {
    "adminToken": "<adminToken>"
  }
}
```
