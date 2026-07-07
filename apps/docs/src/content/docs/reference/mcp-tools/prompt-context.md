---
title: "prompt_context"
description: "Assemble a token-budgeted context block from memories most relevant to a query. Greedy-packs ranked memories within the token budget (1 token ≈ 4 chars). Returns the formatted block plus token accounting metadata."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Assemble a token-budgeted context block from memories most relevant to a query. Greedy-packs ranked memories within the token budget (1 token ≈ 4 chars). Returns the formatted block plus token accounting metadata.

**Auth mode:** `identity`  
**Required scope:** `memories:read`  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `query` | string | yes | — | — |
| `tokenBudget` | integer | no | `2000` | — |
| `limit` | integer | no | `20` | — |
| `minScore` | number | no | `0.5` | — |
| `scope` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `createdFrom` | object | no | — | — |
| `createdTo` | object | no | — | — |

## Example

```json
{
  "name": "prompt_context",
  "arguments": {
    "userId": "qp",
    "query": "<query>"
  }
}
```
