---
title: "promote_memory"
description: "Promote short-term memory to long-term storage"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Promote short-term memory to long-term storage

**Auth mode:** `identity`  
**Required scope:** `memories:write`  
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
  "name": "promote_memory",
  "arguments": {
    "userId": "qp",
    "memoryId": "<memoryId>"
  }
}
```
