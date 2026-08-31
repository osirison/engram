---
title: "compress_context"
description: "Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget. Use it to inject task-specific background under a size limit measured in characters; prompt_context is the token-budgeted variant, and load_context primes a session when there is no query yet. Every response carries retrievalMode: normally \"semantic\", but \"lexical\" when no embedding provider is configured, in which case memories are matched by keyword, minScore is scored on that different scale, and a thin or empty result is not evidence that nothing relevant is stored."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget. Use it to inject task-specific background under a size limit measured in characters; prompt_context is the token-budgeted variant, and load_context primes a session when there is no query yet. Every response carries retrievalMode: normally "semantic", but "lexical" when no embedding provider is configured, in which case memories are matched by keyword, minScore is scored on that different scale, and a thin or empty result is not evidence that nothing relevant is stored.

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
