---
title: "delete_memory"
description: "Delete memory by ID"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Delete memory by ID

**Auth mode:** `identity`  
**Required scope:** `memories:delete`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `memoryId` | string | yes | — | — |
| `scope` | string | no | — | — |
| `actorLabel` | string | no | — | — |

## Example

```json
{
  "name": "delete_memory",
  "arguments": {
    "userId": "qp",
    "memoryId": "<memoryId>"
  }
}
```
