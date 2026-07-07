---
title: "compress_context"
description: "Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget.

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
