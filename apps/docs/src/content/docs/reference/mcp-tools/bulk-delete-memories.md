---
title: "bulk_delete_memories"
description: "Delete up to 100 memories in a single call, returning a per-item report of deleted ids and failures. STM/LTM routing and scope isolation are inherited per id."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Delete up to 100 memories in a single call, returning a per-item report of deleted ids and failures. STM/LTM routing and scope isolation are inherited per id.

**Auth mode:** `identity`  
**Required scope:** `memories:delete`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `memoryIds` | string[] | yes | — | — |
| `scope` | string | no | — | — |
| `actorLabel` | string | no | — | — |

## Example

```json
{
  "name": "bulk_delete_memories",
  "arguments": {
    "userId": "qp",
    "memoryIds": []
  }
}
```
