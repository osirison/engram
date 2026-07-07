---
title: "reembed_memory"
description: "Regenerate the vector for a long-term memory's current content and clear its embeddingStale flag. Repairs recall drift left by a content edit made while the embeddings provider was unavailable."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Regenerate the vector for a long-term memory's current content and clear its embeddingStale flag. Repairs recall drift left by a content edit made while the embeddings provider was unavailable.

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
  "name": "reembed_memory",
  "arguments": {
    "userId": "qp",
    "memoryId": "<memoryId>"
  }
}
```
