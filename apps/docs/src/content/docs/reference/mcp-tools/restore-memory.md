---
title: "restore_memory"
description: "Recreate a hard-deleted memory from its most recent delete audit snapshot, preserving its original id. Requires the audit trail."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Recreate a hard-deleted memory from its most recent delete audit snapshot, preserving its original id. Requires the audit trail.

**Auth mode:** `identity`  
**Required scope:** `memories:write`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `memoryId` | string | yes | — | — |
| `actorLabel` | string | no | — | — |

## Example

```json
{
  "name": "restore_memory",
  "arguments": {
    "userId": "qp",
    "memoryId": "<memoryId>"
  }
}
```
