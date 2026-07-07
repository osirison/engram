---
title: "retry_reindex_job"
description: "Retry a failed/cancelled reindex job from its last persisted cursor"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Retry a failed/cancelled reindex job from its last persisted cursor

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
  "name": "retry_reindex_job",
  "arguments": {
    "adminToken": "<adminToken>",
    "jobId": "<jobId>"
  }
}
```
