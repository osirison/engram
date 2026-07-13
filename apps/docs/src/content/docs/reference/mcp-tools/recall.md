---
title: "recall"
description: "Semantically recall the most relevant long-term memories for a natural-language query — the primary retrieval tool; reach for it before starting any task the user may have stored context on. Embeds the query and searches the vector index (an in-process hybrid lexical+semantic index under the memory/lite profiles), re-ranking hits by blended similarity, recency, and importance. Superseded memories never resurface. Supports scope, tag, and created-date filters; use list_memories instead for exact, non-semantic listing."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Semantically recall the most relevant long-term memories for a natural-language query — the primary retrieval tool; reach for it before starting any task the user may have stored context on. Embeds the query and searches the vector index (an in-process hybrid lexical+semantic index under the memory/lite profiles), re-ranking hits by blended similarity, recency, and importance. Superseded memories never resurface. Supports scope, tag, and created-date filters; use list_memories instead for exact, non-semantic listing.

**Auth mode:** `identity`  
**Required scope:** `memories:read`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `query` | string | yes | — | — |
| `limit` | integer | no | `10` | — |
| `scope` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `createdFrom` | object | no | — | — |
| `createdTo` | object | no | — | — |

## Example

```json
{
  "name": "recall",
  "arguments": {
    "userId": "qp",
    "query": "<query>"
  }
}
```
