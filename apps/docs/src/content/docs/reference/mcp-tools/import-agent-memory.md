---
title: "import_agent_memory"
description: "Import agent memory files (Claude/Copilot/Cursor/Codex/Gemini/markdown) from a server-side path into long-term memory, preserving inter-memory links. Admin-gated; idempotent; supports dryRun and a secrets policy. Never overwrites a memory edited inside ENGRAM since its last import: such facts are skipped and counted as skippedConcurrentEdit in the summary (CAS-skip)."
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Import agent memory files (Claude/Copilot/Cursor/Codex/Gemini/markdown) from a server-side path into long-term memory, preserving inter-memory links. Admin-gated; idempotent; supports dryRun and a secrets policy. Never overwrites a memory edited inside ENGRAM since its last import: such facts are skipped and counted as skippedConcurrentEdit in the summary (CAS-skip).

**Auth mode:** `admin`  
**Admin tool:** requires `MCP_ADMIN_TOKEN`.  

## Input parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| `adminToken` | string | yes | — | — |
| `source` | `claude-code` \| `copilot` \| `cursor` \| `codex` \| `gemini` \| `markdown` | yes | — | — |
| `path` | string | yes | — | — |
| `userId` | string | yes | — | — |
| `scope` | string | no | — | — |
| `dryRun` | boolean | no | — | — |
| `secretsPolicy` | `redact` \| `flag` \| `skip` \| `fail` | no | — | — |
| `embed` | boolean | no | — | — |
| `splitHeadings` | boolean | no | — | — |
| `includeGlobal` | boolean | no | — | — |

## Example

```json
{
  "name": "import_agent_memory",
  "arguments": {
    "adminToken": "<adminToken>",
    "source": "claude-code",
    "path": "<path>",
    "userId": "qp"
  }
}
```
