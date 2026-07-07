---
title: "recall"
description: "Semantically recall the most relevant long-term memories for a natural-language query"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Semantically recall the most relevant long-term memories for a natural-language query

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
