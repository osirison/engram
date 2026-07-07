---
title: "get_reindex_status"
description: "Get status and progress for a queued reindex job (queued/running/completed/failed)"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Get status and progress for a queued reindex job (queued/running/completed/failed)

**Auth mode:** `admin`  
**Admin tool:** requires `MCP_ADMIN_TOKEN`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `adminToken` | string | yes | — | — |
| `jobId` | string | yes | — | — |

## Example

```json
{
  "name": "get_reindex_status",
  "arguments": {
    "adminToken": "<adminToken>",
    "jobId": "<jobId>"
  }
}
```
