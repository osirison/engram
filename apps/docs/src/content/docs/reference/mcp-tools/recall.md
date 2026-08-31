---
title: "recall"
description: "Semantically recall the most relevant long-term memories for a natural-language query — the primary retrieval tool; reach for it before starting any task the user may have stored context on. Embeds the query and searches the pgvector index, re-ranking hits by blended similarity, recency, and importance. Superseded memories never resurface. Supports scope, tag, and created-date filters; use list_memories instead for exact, non-semantic listing. Every response carries retrievalMode: normally \"semantic\", but \"lexical\" when no embedding provider is configured, in which case results are keyword matches and an empty result does not prove the memory was never stored."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Semantically recall the most relevant long-term memories for a natural-language query — the primary retrieval tool; reach for it before starting any task the user may have stored context on. Embeds the query and searches the pgvector index, re-ranking hits by blended similarity, recency, and importance. Superseded memories never resurface. Supports scope, tag, and created-date filters; use list_memories instead for exact, non-semantic listing. Every response carries retrievalMode: normally "semantic", but "lexical" when no embedding provider is configured, in which case results are keyword matches and an empty result does not prove the memory was never stored.

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
