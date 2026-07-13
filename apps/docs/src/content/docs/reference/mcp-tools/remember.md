---
title: "remember"
description: "Smart create: auto-detects short-term vs long-term storage from content heuristics, deduplicates against existing memories, and returns the stored memory with routing metadata. The preferred write path for agents — store durable facts as you learn them; re-storing a known fact is safe (absorbed by dedup). Use create_memory only when you must control the tier explicitly."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Smart create: auto-detects short-term vs long-term storage from content heuristics, deduplicates against existing memories, and returns the stored memory with routing metadata. The preferred write path for agents — store durable facts as you learn them; re-storing a known fact is safe (absorbed by dedup). Use create_memory only when you must control the tier explicitly.

**Auth mode:** `identity`  
**Required scope:** `memories:write`  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `content` | string | yes | — | — |
| `type` | `auto` \| `short-term` \| `long-term` | no | `"auto"` | — |
| `scope` | string | no | — | — |
| `metadata` | object | no | — | — |
| `tags` | string[] | no | `[]` | — |
| `ttl` | integer | no | — | — |
| `skipDuplicateCheck` | boolean | no | `false` | — |

## Example

```json
{
  "name": "remember",
  "arguments": {
    "userId": "qp",
    "content": "<content>"
  }
}
```
