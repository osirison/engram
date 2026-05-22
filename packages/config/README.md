---
title: ENGRAM Config Package
description: Environment validation and typed configuration for ENGRAM workspaces
---

## Overview

`@engram/config` owns the shared environment schema for ENGRAM. It exports the
Zod schema, validation helper, and inferred `Env` type used by services that
need typed configuration.

## Exports

| Export        | Purpose                                        |
| ------------- | ---------------------------------------------- |
| `envSchema`   | Zod schema for supported environment variables |
| `validateEnv` | Parse and validate an environment object       |
| `Env`         | TypeScript type inferred from the schema       |

## Usage

```typescript
import { validateEnv, type Env } from '@engram/config';

const env: Env = validateEnv(process.env);
```

## Commands

| Task       | Command                                  |
| ---------- | ---------------------------------------- |
| Build      | `pnpm --filter @engram/config build`     |
| Run lint   | `pnpm --filter @engram/config lint`      |
| Type-check | `pnpm --filter @engram/config typecheck` |
| Run tests  | `pnpm --filter @engram/config test`      |

## Related Docs

- Local setup: [../../docs/SETUP.md](../../docs/SETUP.md)
- Root environment defaults: [../../.env.example](../../.env.example)
