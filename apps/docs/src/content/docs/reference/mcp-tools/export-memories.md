---
title: "export_memories"
description: "Export a user's memories as an Obsidian-compatible markdown vault (YAML frontmatter + [[wikilinks]] preserving inter-memory relationships). Bounded exports return documents + manifest inline; larger exports return a server path reference."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Export a user's memories as an Obsidian-compatible markdown vault (YAML frontmatter + [[wikilinks]] preserving inter-memory relationships). Bounded exports return documents + manifest inline; larger exports return a server path reference.

**Auth mode:** `identity`  
**Required scope:** `memories:read`  
**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `includeStm` | boolean | no | — | — |
| `tags` | string[] | no | — | — |
| `dateFrom` | string | no | — | — |
| `dateTo` | string | no | — | — |
| `scope` | string | no | — | — |
| `type` | `short-term` \| `long-term` | no | — | — |
| `mode` | `multi` \| `single` | no | — | — |
| `maxInline` | integer | no | `25` | — |

## Example

```json
{
  "name": "export_memories",
  "arguments": {
    "userId": "qp"
  }
}
```
