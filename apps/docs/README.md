---
title: ENGRAM Docs App
description: Local development guide for the ENGRAM documentation app workspace
---

## Overview

The docs workspace is a Next.js app for project documentation. It is separate
from Markdown files under [../../docs](../../docs), which are plain repository
docs linked from the root README.

## Start

Run from the repository root:

```bash
npm exec --yes pnpm@11.4.0 -- install
npm exec --yes pnpm@11.4.0 -- --filter docs dev
```

Open `http://localhost:3001`.
Command tables use the shorter `pnpm` form after pnpm is installed.

## Commands

| Task                     | Command                          |
| ------------------------ | -------------------------------- |
| Start development server | `pnpm --filter docs dev`         |
| Build                    | `pnpm --filter docs build`       |
| Run lint                 | `pnpm --filter docs lint`        |
| Type-check               | `pnpm --filter docs check-types` |

## Related Docs

- Root setup: [../../README.md](../../README.md)
- Local environment: [../../docs/SETUP.md](../../docs/SETUP.md)
