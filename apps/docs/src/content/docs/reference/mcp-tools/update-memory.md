---
title: "update_memory"
description: "Update existing memory"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Update existing memory

**Auth mode:** `identity`  
**Required scope:** `memories:write`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `memoryId` | string | yes | — | — |
| `content` | string | no | — | — |
| `metadata` | object | no | — | — |
| `tags` | string[] | no | — | — |
| `ttl` | integer | no | — | — |
| `scope` | string | no | — | — |
| `expectedVersion` | integer | no | — | — |
| `actorLabel` | string | no | — | — |

## Example

```json
{
  "name": "update_memory",
  "arguments": {
    "userId": "qp",
    "memoryId": "<memoryId>"
  }
}
```
