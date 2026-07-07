---
title: Reference
description: Auto-generated reference material for Engram — MCP tools, configuration, and package APIs.
---

Engram's reference documentation is generated directly from source so it never
drifts from the running code:

- **MCP Tools** — one page per MCP tool, generated from the server's Zod input
  schemas. Regenerate with `pnpm docs:generate`.
- **Configuration** — every environment variable with its type, default, and
  profile requirement, extracted from `@engram/config`. Regenerate with
  `pnpm docs:generate`.
- **API** — TypeDoc reference for each `@engram/*` package, generated at build
  time from the TypeScript sources.

Regenerate the committed reference pages any time the code changes:

```bash
pnpm docs:generate
```

CI runs the same command and fails if the committed output is stale, so the
reference always matches `main`.
