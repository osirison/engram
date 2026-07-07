---
title: "list_memories"
description: "List memories with pagination and filtering"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

List memories with pagination and filtering

**Auth mode:** `identity`  
**Required scope:** `memories:read`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `type` | `short-term` \| `long-term` | no | — | — |
| `limit` | integer | no | `20` | — |
| `cursor` | string | no | — | — |
| `scope` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `search` | string | no | — | — |

## Example

```json
{
  "name": "list_memories",
  "arguments": {
    "userId": "qp"
  }
}
```
