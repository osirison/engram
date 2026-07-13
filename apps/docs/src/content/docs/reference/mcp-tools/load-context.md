---
title: "load_context"
description: "Load a session-priming context block by blending the most recent memories with the highest-importance memories. Needs no query — call it once at session start, before any task context exists, to inject into the session-opening prompt; switch to recall or compress_context once you have a concrete topic."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Load a session-priming context block by blending the most recent memories with the highest-importance memories. Needs no query — call it once at session start, before any task context exists, to inject into the session-opening prompt; switch to recall or compress_context once you have a concrete topic.

**Auth mode:** `identity`  
**Required scope:** `memories:read`  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `userId` | string | yes | — | — |
| `maxChars` | integer | no | `6000` | — |
| `recentLimit` | integer | no | `5` | — |
| `importantLimit` | integer | no | `10` | — |
| `scope` | string | no | — | — |
| `tags` | string[] | no | — | — |

## Example

```json
{
  "name": "load_context",
  "arguments": {
    "userId": "qp"
  }
}
```
