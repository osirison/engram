---
title: "cancel_reindex_job"
description: "Cancel a queued/running reindex job and preserve progress cursor"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Cancel a queued/running reindex job and preserve progress cursor

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
  "name": "cancel_reindex_job",
  "arguments": {
    "adminToken": "<adminToken>",
    "jobId": "<jobId>"
  }
}
```
