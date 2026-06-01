---
title: ENGRAM Web App
description: Local development guide for the ENGRAM web workspace
---

## Overview

The web workspace is a Next.js app for future ENGRAM user-facing workflows. It
shares the monorepo UI and TypeScript configuration packages.

## Start

Run from the repository root:

```bash
npm exec --yes pnpm@11.4.0 -- install
npm exec --yes pnpm@11.4.0 -- --filter web dev
```

Open `http://localhost:3000`.
Command tables use the shorter `pnpm` form after pnpm is installed.

## Commands

| Task                     | Command                         |
| ------------------------ | ------------------------------- |
| Start development server | `pnpm --filter web dev`         |
| Build                    | `pnpm --filter web build`       |
| Run lint                 | `pnpm --filter web lint`        |
| Type-check               | `pnpm --filter web check-types` |

The web app uses port `3000`, the same default port as the MCP server. Run one
of them at a time or change the port for one process.

## Related Docs

- Root setup: [../../README.md](../../README.md)
- Local environment: [../../docs/SETUP.md](../../docs/SETUP.md)
- Shared UI package: [../../packages/ui](../../packages/ui)
