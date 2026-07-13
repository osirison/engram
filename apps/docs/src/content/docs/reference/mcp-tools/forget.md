---
title: "forget"
description: "Smart delete: find memories by natural-language concept and optionally delete them. Dry-run by default — review the matches, then pass confirm=true to execute deletion. Use it when the user asks to remove or redact something described conceptually rather than by id; delete_memory removes a single known id."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Smart delete: find memories by natural-language concept and optionally delete them. Dry-run by default — review the matches, then pass confirm=true to execute deletion. Use it when the user asks to remove or redact something described conceptually rather than by id; delete_memory removes a single known id.

**Auth mode:** `identity`  
**Required scope:** `memories:delete`  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `query` | string | yes | — | — |
| `limit` | integer | no | `5` | — |
| `confirm` | boolean | no | `false` | — |
| `minScore` | number | no | `0.6` | — |
| `scope` | string | no | — | — |

## Example

```json
{
  "name": "forget",
  "arguments": {
    "userId": "qp",
    "query": "<query>"
  }
}
```
