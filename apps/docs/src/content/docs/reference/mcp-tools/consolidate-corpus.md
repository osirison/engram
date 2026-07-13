---
title: "consolidate_corpus"
description: "Corpus consolidation (admin): cluster NEAR-duplicate long-term memories in the [MEMORY_CONSOLIDATION_MERGE_THRESHOLD, MEMORY_DUPLICATE_THRESHOLD) similarity band, keep one canonical per cluster (highest importance, most recent on ties), union tags onto it, and mark the rest superseded + linked. NOT `consolidate_memories` (the unrelated STM→LTM promotion pass). Review-gated: dryRun defaults to TRUE and reports would-be merges without mutating — pass dryRun=false explicitly to merge. Idempotent and cursor-resumable."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Corpus consolidation (admin): cluster NEAR-duplicate long-term memories in the [MEMORY_CONSOLIDATION_MERGE_THRESHOLD, MEMORY_DUPLICATE_THRESHOLD) similarity band, keep one canonical per cluster (highest importance, most recent on ties), union tags onto it, and mark the rest superseded + linked. NOT `consolidate_memories` (the unrelated STM→LTM promotion pass). Review-gated: dryRun defaults to TRUE and reports would-be merges without mutating — pass dryRun=false explicitly to merge. Idempotent and cursor-resumable.

**Auth mode:** `admin`  
**Admin tool:** requires `MCP_ADMIN_TOKEN`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `adminToken` | string | yes | — | — |
| `userId` | string | no | — | — |
| `scope` | string | no | — | — |
| `dryRun` | boolean | no | `true` | — |
| `limit` | integer | no | — | — |
| `cursor` | string | no | — | — |

## Example

```json
{
  "name": "consolidate_corpus",
  "arguments": {
    "adminToken": "<adminToken>"
  }
}
```
