---
title: "load_context"
description: "Load a session-priming context block by blending the most recent memories with the highest-importance memories. Ideal for injecting into a session-opening prompt."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Load a session-priming context block by blending the most recent memories with the highest-importance memories. Ideal for injecting into a session-opening prompt.

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
