---
title: "get_memory"
description: "Retrieve memory by ID"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Retrieve memory by ID

**Auth mode:** `identity`  
**Required scope:** `memories:read`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `memoryId` | string | yes | — | — |
| `scope` | string | no | — | — |

## Example

```json
{
  "name": "get_memory",
  "arguments": {
    "userId": "qp",
    "memoryId": "<memoryId>"
  }
}
```
