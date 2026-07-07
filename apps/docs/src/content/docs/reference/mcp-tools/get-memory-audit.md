---
title: "get_memory_audit"
description: "Read the append-only audit history (update/delete/promote/reembed/restore) for a memory, newest first."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Read the append-only audit history (update/delete/promote/reembed/restore) for a memory, newest first.

**Auth mode:** `identity`  
**Required scope:** `memories:read`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `memoryId` | string | yes | — | — |
| `limit` | integer | no | `50` | — |

## Example

```json
{
  "name": "get_memory_audit",
  "arguments": {
    "userId": "qp",
    "memoryId": "<memoryId>"
  }
}
```
