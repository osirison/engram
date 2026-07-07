---
title: Engram Docs App
description: Local development guide for the Engram developer documentation site (Astro Starlight)
---

## Overview

The docs workspace is an [Astro Starlight](https://starlight.astro.build) site
that hosts Engram's developer documentation. It is deployed as a merged artifact
under `/docs` on the marketing-site GitHub Pages deploy (served at
`https://engram.events/docs`).

The Markdown files under [../../docs](../../docs) are plain repository docs; their
canonical content is migrated into this site (each original file is kept as a stub
that links here).

## Start

Engram pins `pnpm@11.5.0` via `packageManager`, so contributors don't need a
global pnpm. Run from the repository root:

```bash
npm exec --yes pnpm@11.5.0 -- install
npm exec --yes pnpm@11.5.0 -- --filter docs dev
```

Command tables below use the shorter `pnpm` form, which works once pnpm is on
your PATH.

Open `http://localhost:3001/docs/`. The `/docs` base path mirrors production so
that sidebar links and Pagefind search resolve the same way locally.

## Commands

| Task                     | Command                          |
| ------------------------ | -------------------------------- |
| Start development server | `pnpm --filter docs dev`         |
| Build (static site)      | `pnpm --filter docs build`       |
| Preview built site       | `pnpm --filter docs preview`     |
| Type-check content       | `pnpm --filter docs check-types` |

## Generated reference

Three reference sections are generated from source, not hand-written:

| Section                      | Generator                      | Committed?                     |
| ---------------------------- | ------------------------------ | ------------------------------ |
| `reference/configuration.md` | `scripts/gen-env-table.mjs`    | yes                            |
| `reference/mcp-tools/`       | `scripts/gen-mcp-tools.mjs`    | yes                            |
| `reference/api/`             | `starlight-typedoc` (at build) | no (git-ignored; always fresh) |

Regenerate the committed reference pages from the repository root:

```bash
pnpm docs:generate
```

CI runs the same command and fails if the committed output is stale.

## Related docs

- Root setup: [../../README.md](../../README.md)
- Local environment: [../../docs/SETUP.md](../../docs/SETUP.md)
