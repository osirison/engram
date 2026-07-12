---
title: "update_memory"
description: "Update an existing memory. expectedVersion is required (optimistic concurrency): pass the version returned by get_memory or a prior read. Blind updates are rejected, and a stale version fails with a CONFLICT error — re-read the memory and retry with the fresh version."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Update an existing memory. expectedVersion is required (optimistic concurrency): pass the version returned by get_memory or a prior read. Blind updates are rejected, and a stale version fails with a CONFLICT error — re-read the memory and retry with the fresh version.

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
| `expectedVersion` | integer | yes | — | — |
| `actorLabel` | string | no | — | — |

## Example

```json
{
  "name": "update_memory",
  "arguments": {
    "userId": "qp",
    "memoryId": "<memoryId>",
    "expectedVersion": 1
  }
}
```
