---
title: "consolidate_memories"
description: "Trigger a synchronous STM→LTM consolidation pass (admin). Promotes short-term memories that meet the access-count and importance thresholds into long-term storage; a scheduled pass already runs every STM_CONSOLIDATION_INTERVAL_MS (default 5 min), so call this only when promotion must happen now — e.g. before an export, migration, or shutdown. Idempotent (already-promoted rows are skipped). NOT corpus consolidation — near-duplicate merging is `consolidate_corpus`."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Trigger a synchronous STM→LTM consolidation pass (admin). Promotes short-term memories that meet the access-count and importance thresholds into long-term storage; a scheduled pass already runs every STM_CONSOLIDATION_INTERVAL_MS (default 5 min), so call this only when promotion must happen now — e.g. before an export, migration, or shutdown. Idempotent (already-promoted rows are skipped). NOT corpus consolidation — near-duplicate merging is `consolidate_corpus`.

**Auth mode:** `admin`  
**Admin tool:** requires `MCP_ADMIN_TOKEN`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `adminToken` | string | yes | — | — |
| `userId` | string | no | — | — |

## Example

```json
{
  "name": "consolidate_memories",
  "arguments": {
    "adminToken": "<adminToken>"
  }
}
```
