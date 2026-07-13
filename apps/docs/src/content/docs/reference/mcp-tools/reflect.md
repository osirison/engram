---
title: "reflect"
description: "Synthesise structured insights across all memories semantically relevant to a query. Returns a plain-text summary, extracted themes, source memory IDs, and date range. Use it for thematic questions (\"what do we know about X?\") and periodic reviews where a synthesis beats a raw hit list — recall returns the individual memories instead."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Synthesise structured insights across all memories semantically relevant to a query. Returns a plain-text summary, extracted themes, source memory IDs, and date range. Use it for thematic questions ("what do we know about X?") and periodic reviews where a synthesis beats a raw hit list — recall returns the individual memories instead.

**Auth mode:** `identity`  
**Required scope:** `memories:read`  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `query` | string | yes | — | — |
| `limit` | integer | no | `10` | — |
| `minScore` | number | no | `0.5` | — |
| `scope` | string | no | — | — |
| `tags` | string[] | no | — | — |

## Example

```json
{
  "name": "reflect",
  "arguments": {
    "userId": "qp",
    "query": "<query>"
  }
}
```
