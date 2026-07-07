---
title: "ingest_conversation"
description: "Bulk-ingest a conversation as per-turn long-term memories. Handles chunking for large turns, controls embedding back-pressure via concurrency, and is idempotent: re-submitting the same conversation returns the existing memory IDs."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Bulk-ingest a conversation as per-turn long-term memories. Handles chunking for large turns, controls embedding back-pressure via concurrency, and is idempotent: re-submitting the same conversation returns the existing memory IDs.

**Auth mode:** `identity`  
**Required scope:** `memories:write`  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `turns` | object[] | yes | — | — |
| `tags` | string[] | no | `[]` | — |
| `metadata` | object | no | — | — |
| `concurrency` | integer | no | `5` | — |

## Example

```json
{
  "name": "ingest_conversation",
  "arguments": {
    "userId": "qp",
    "turns": []
  }
}
```
