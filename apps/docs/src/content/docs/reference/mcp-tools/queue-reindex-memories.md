---
title: "queue_reindex_memories"
description: "Queue asynchronous vector reindexing with persisted progress and resumability cursor"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Queue asynchronous vector reindexing with persisted progress and resumability cursor

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
  "name": "queue_reindex_memories",
  "arguments": {
    "adminToken": "<adminToken>"
  }
}
```
