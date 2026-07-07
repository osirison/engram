---
title: "create_memory"
description: "Create a new memory in short-term or long-term storage"
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Create a new memory in short-term or long-term storage

**Auth mode:** `identity`  
**Required scope:** `memories:write`  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `content` | string | yes | — | — |
| `type` | `short-term` \| `long-term` | yes | — | — |
| `scope` | string | no | — | — |
| `metadata` | object | no | — | — |
| `tags` | string[] | no | `[]` | — |
| `ttl` | integer | no | — | — |

## Example

```json
{
  "name": "create_memory",
  "arguments": {
    "userId": "qp",
    "content": "<content>",
    "type": "short-term"
  }
}
```
