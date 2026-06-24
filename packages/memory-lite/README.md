---
title: '@engram/memory-lite'
description: Encrypted-at-rest, owner-only file-backed JSON memory store for the ENGRAM profile-lite deployment mode
---

# @engram/memory-lite

Encrypted-at-rest, owner-only file-backed JSON memory store for the ENGRAM
`profile-lite` deployment mode.

## Features

- AES-256-GCM per-record encryption with versioned nonce (`v1:` prefix).
- Owner-only filesystem permissions enforced at startup (dir `0700`, files `0600`).
- Atomic writes via temp-file-then-rename to avoid partial-write corruption.
- Per-user concurrency lock to serialize writes inside a single process.
- Explicit `LOCAL_INSECURE_MODE` break-glass for local development only.
- Resists `LOCAL_INSECURE_MODE=true` startup when `NODE_ENV=production`.

## Public surface

```ts
import {
  LiteJsonStore,
  LITE_STORE_TOKEN,
  assertSecureStartup,
  encrypt,
  decrypt,
} from '@engram/memory-lite';
```

See [src/index.ts](./src/index.ts) for the full export list.
