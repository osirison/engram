---
title: "forget"
description: "Smart delete: find memories by natural-language concept and optionally delete them. Dry-run by default — pass confirm=true to execute deletion."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Smart delete: find memories by natural-language concept and optionally delete them. Dry-run by default — pass confirm=true to execute deletion.

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
