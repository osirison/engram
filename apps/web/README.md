---
title: ENGRAM Admin Console
description: tRPC + Next.js operator dashboard for inspecting and managing memories
---

## Overview

`apps/web` is the **ENGRAM admin console** — a type-safe tRPC API and Next.js
(App Router) dashboard for operators to browse, search, and manage memories and
to monitor system health. It implements epic E6 (#103): Tailwind v4 + shadcn/ui,
NextAuth.js v5 auth, a memory navigator, a memory detail drawer, a real-time
health view, and insights & analytics.

## Architecture

The dashboard talks to the ENGRAM backend through a single, mockable seam,
`EngramBackend` (`server/backend/`):

- **Reads & analytics — direct Postgres.** Listing, filtering, counts, tag/type
  distributions, and activity series query Postgres (the source of truth) via
  `@prisma/client`. No MCP tool exposes these aggregations.
- **Writes & semantic recall — the MCP server.** `update_memory`,
  `delete_memory`, and `recall` go through the MCP server over its `/mcp`
  endpoint, so the derived vector index stays in sync (a raw Prisma write would
  desync Qdrant/pgvector). Configure `ENGRAM_MCP_URL` to enable these; without
  it the console runs read-only with keyword search.

  When the MCP server enforces auth (`AUTH_REQUIRED=true`), set
  `ENGRAM_API_KEY`. The key's scopes decide how far the console reaches: an
  **admin-scoped key** may act on behalf of any data owner (the MCP dispatcher
  honours the console-supplied `userId` — delegated mode, audited server-side),
  while a non-admin key is pinned to its own tenant, so writes and semantic
  search only work for that single owner. `meta.capabilities` reports the
  detected mode (`delegation`: `admin` / `tenant-limited` / `unrestricted` /
  `unknown`) and the Settings page shows a warning when the console is
  tenant-limited.
- **Health & metrics — the MCP server HTTP endpoints** (`/health`,
  `/health/metrics`).

Auth is **NextAuth.js v5** (Google/GitHub, plus an env-gated dev provider) with
JWT sessions wired into the tRPC context. Sign-in is gated by the
`ENGRAM_ADMIN_EMAILS` allow-list. Every signed-in operator can switch the active
data owner (`userId`) via the header scope switcher.

```
app/                         Routes: (dashboard) group, /signin, /api/{auth,trpc}
components/ui/               shadcn/ui primitives (Tailwind v4, CSS-variable theme)
components/{layout,memories,health,analytics}/   feature components
server/backend/              EngramBackend interface + Prisma/MCP adapter
server/trpc/                 routers (memory, health, analytics, meta) + context
auth.ts, proxy.ts            NextAuth config + route protection
```

## Start

Run from the repository root:

```bash
pnpm install
pnpm db:generate                     # generate the Prisma client
cp .env.example .env                 # set AUTH_SECRET; ENGRAM_DASHBOARD_DEV_AUTH=true for local sign-in
pnpm --filter web dev                # dashboard on http://localhost:3001
```

The console uses port `3001`; the MCP server uses `3000`, so both can run at
once. For semantic search and edit/delete, point `ENGRAM_MCP_URL` at a running
MCP server. See the dashboard section of [`.env.example`](../../.env.example)
for all variables.

## Commands

| Task               | Command                       |
| ------------------ | ----------------------------- |
| Development server | `pnpm --filter web dev`       |
| Build              | `pnpm --filter web build`     |
| Lint               | `pnpm --filter web lint`      |
| Type-check         | `pnpm --filter web typecheck` |
| Tests              | `pnpm --filter web test`      |

## Related Docs

- Root setup: [../../README.md](../../README.md)
- Local environment: [../../docs/SETUP.md](../../docs/SETUP.md)
- Shared UI package: [../../packages/ui](../../packages/ui)
