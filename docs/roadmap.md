---
title: ENGRAM Roadmap
description: Current near-term development focus for the ENGRAM repository
---

## Current Focus

ENGRAM is stabilizing the developer path for the MCP memory server. The next
work should make local setup predictable, keep CI useful, and continue building
the memory packages behind the MCP runtime.

## Active Tracks

| Track                 | Goal                                                                    | Current next step                                                    |
| --------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Documentation         | Keep setup and package docs short, current, and linked                  | Maintain README links and run `pnpm docs:check` in CI                |
| MCP server quality    | Make the NestJS MCP runtime lint, type-check, and test cleanly          | Fix workspace package type resolution and remove broad lint disables |
| Memory packages       | Keep STM, LTM, embeddings, Redis, database, and vector packages aligned | Add focused tests and docs when behavior changes                     |
| MCP client validation | Make client setup easy to verify from a clean checkout                  | Keep `claude_desktop_config.json.example` and setup docs current     |

## Near-Term Sequence

1. Finish documentation validation and package README coverage.
2. Fix MCP server lint debt so CI failures are meaningful.
3. Add or update tests around memory workflows affected by lint/type fixes.
4. Verify MCP client setup from a clean build.
5. Expand roadmap details only when issue priorities are confirmed.

## Quality Gates

Run these checks before opening a pull request when the touched area supports
them:

```bash
pnpm docs:check
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

For the MCP server specifically:

```bash
pnpm --filter mcp-server lint
pnpm --filter mcp-server test
```

## Working Agreements

- Start from a feature branch, not `main`.
- Keep changes tied to the issue or request in front of you.
- Prefer existing workspace packages and framework CLIs.
- Update [../README.md](../README.md) and [SETUP.md](SETUP.md) when startup commands change.
- Keep detailed implementation notes in focused docs rather than expanding the root README.

## Links

- Developer setup: [../README.md](../README.md)
- Local setup details: [SETUP.md](SETUP.md)
- Agent guidance: [../AGENTS.md](../AGENTS.md)
- MCP server: [../apps/mcp-server/README.md](../apps/mcp-server/README.md)
