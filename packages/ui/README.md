---
title: ENGRAM UI Package
description: Shared React components for ENGRAM frontend workspaces
---

## Overview

`@repo/ui` contains shared React components used by frontend workspaces in the
monorepo. Components are exported from `src` through package subpath exports.

## Components

| Component | File                             |
| --------- | -------------------------------- |
| `Button`  | [src/button.tsx](src/button.tsx) |
| `Card`    | [src/card.tsx](src/card.tsx)     |
| `Code`    | [src/code.tsx](src/code.tsx)     |

## Usage

```tsx
import { Button } from '@repo/ui/button';

export function Example() {
  return <Button appName="web">Save</Button>;
}
```

## Commands

| Task               | Command                                     |
| ------------------ | ------------------------------------------- |
| Run lint           | `pnpm --filter @repo/ui lint`               |
| Type-check         | `pnpm --filter @repo/ui check-types`        |
| Generate component | `pnpm --filter @repo/ui generate:component` |

## Related Docs

- Web app: [../../apps/web/README.md](../../apps/web/README.md)
- Docs app: [../../apps/docs/README.md](../../apps/docs/README.md)
