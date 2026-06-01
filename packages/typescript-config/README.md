---
title: ENGRAM TypeScript Config Package
description: Shared TypeScript configuration presets for ENGRAM workspaces
---

## Overview

`@repo/typescript-config` contains shared `tsconfig` presets for ENGRAM
workspaces. Packages and apps extend these files to keep compiler settings
consistent.

## Presets

| File                                     | Purpose                                    |
| ---------------------------------------- | ------------------------------------------ |
| [base.json](base.json)                   | Strict base config for TypeScript packages |
| [nextjs.json](nextjs.json)               | Next.js app config                         |
| [react-library.json](react-library.json) | React library config                       |

## Usage

Extend a preset from a workspace `tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json"
}
```

## Related Docs

- Root setup: [../../README.md](../../README.md)
- Agent rules: [../../AGENTS.md](../../AGENTS.md)
