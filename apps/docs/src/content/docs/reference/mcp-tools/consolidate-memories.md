---
title: "consolidate_memories"
description: "Trigger a synchronous STM→LTM consolidation pass (admin). Promotes short-term memories that meet the access-count threshold into long-term storage. NOT corpus consolidation — near-duplicate merging is `consolidate_corpus`."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Trigger a synchronous STM→LTM consolidation pass (admin). Promotes short-term memories that meet the access-count threshold into long-term storage. NOT corpus consolidation — near-duplicate merging is `consolidate_corpus`.

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
