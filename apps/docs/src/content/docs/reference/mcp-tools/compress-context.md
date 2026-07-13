---
title: "compress_context"
description: "Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget. Use it to inject task-specific background under a size limit measured in characters; prompt_context is the token-budgeted variant, and load_context primes a session when there is no query yet."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget. Use it to inject task-specific background under a size limit measured in characters; prompt_context is the token-budgeted variant, and load_context primes a session when there is no query yet.

**Auth mode:** `identity`  
**Required scope:** `memories:read`  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `query` | string | yes | — | — |
| `limit` | integer | no | `10` | — |
| `maxChars` | integer | no | `4000` | — |
| `minScore` | number | no | `0.5` | — |
| `scope` | string | no | — | — |

## Example

```json
{
  "name": "compress_context",
  "arguments": {
    "userId": "qp",
    "query": "<query>"
  }
}
```
