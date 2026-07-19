---
title: ENGRAM
description: Developer setup and project entry points for the ENGRAM MCP memory server
---

## Overview

ENGRAM is a TypeScript monorepo for an MCP memory server. The main runtime is a
NestJS app that connects to PostgreSQL (with the pgvector extension) for agent
memory, semantic search, and health checks. Postgres is the only backing
service — vectors, short-term memory, auth sessions, and rate limits all live
there.

## Prerequisites

- Node.js 20 or newer with npm
- Git
- Optional: pnpm 11.5.0 on your `PATH`
- Optional: Docker and Docker Compose v2 (to run the bundled PostgreSQL
  container — image `pgvector/pgvector:pg16+`)

ENGRAM pins `pnpm@11.5.0` in [package.json](package.json). The quick start
uses npm to run that pinned pnpm version, so it works even when `pnpm` is not
installed globally.

## Choose Your Profile

ENGRAM ships two deployment profiles. Both run on Postgres alone — the same
storage, vectors (pgvector), and durability — and both expose the full MCP tool
set, including the queued reindex / cancel / retry maintenance tools. The MCP
server reads `DEPLOYMENT_PROFILE` to decide which modules, health checks, and
tools to expose; when it is unset, `standard` is the default.

| Profile    | Default | Tenancy                                                   | Backing services      |
| ---------- | ------- | --------------------------------------------------------- | --------------------- |
| `lite`     | No      | Single user — auth/organization stack not wired           | PostgreSQL (pgvector) |
| `standard` | Yes     | Multi-tenant — auth, API keys, organizations, rate limits | PostgreSQL (pgvector) |

The legacy value `enterprise` is accepted as an alias for `standard`; the old
`memory` profile was removed (every profile now runs on Postgres).

The full MCP surface is defined in
[apps/mcp-server/src/memory/tools-manifest.ts](apps/mcp-server/src/memory/tools-manifest.ts)
(the single source of truth for the tool registry). Both profiles expose the
same tools — memory CRUD, promotion, hybrid recall, the
`remember`/`forget`/`reflect`/`compress_context` helpers, and the reindex /
queue / cancel / retry maintenance tools (admin tools additionally require
`MCP_ADMIN_TOKEN`).

### lite — single-user local

Postgres-backed single-user profile. Same durable storage as `standard`, but
the multi-tenant auth/organization stack is not wired, so there is no login or
API-key surface to configure. Best for a personal machine running a local
memory server.

```bash
npm exec --yes pnpm@11.5.0 -- install
test -f .env || cp .env.example .env
npm exec --yes pnpm@11.5.0 -- docker:up
npm exec --yes pnpm@11.5.0 -- db:generate
npm exec --yes pnpm@11.5.0 -- db:migrate
DEPLOYMENT_PROFILE=lite npm exec --yes pnpm@11.5.0 -- build
DEPLOYMENT_PROFILE=lite npm exec --yes pnpm@11.5.0 -- --filter mcp-server dev
```

The MCP server starts on `http://localhost:3000`. Check it with:

```bash
curl http://localhost:3000/health
```

### standard — default multi-tenant

The default when `DEPLOYMENT_PROFILE` is unset. Adds the multi-tenant auth
stack — JWT sessions, per-agent API keys, organizations, and Postgres-backed
rate limiting — on top of the same Postgres storage. Best for shared or
production deployments.

```bash
npm exec --yes pnpm@11.5.0 -- install
test -f .env || cp .env.example .env
npm exec --yes pnpm@11.5.0 -- docker:up
npm exec --yes pnpm@11.5.0 -- db:generate
npm exec --yes pnpm@11.5.0 -- db:migrate
npm exec --yes pnpm@11.5.0 -- build
npm exec --yes pnpm@11.5.0 -- --filter mcp-server dev
```

The MCP server starts on `http://localhost:3000` by default. Check it with:

```bash
curl http://localhost:3000/health
```

To stop local infrastructure without deleting data:

```bash
npm exec --yes pnpm@11.5.0 -- docker:down
```

To remove containers and local volumes:

```bash
npm exec --yes pnpm@11.5.0 -- docker:clean
```

After installing pnpm globally, you can use the shorter `pnpm <command>` form
shown in the command table below. Detailed setup, profile selection, and
profile-to-profile migration runbook live in [docs/SETUP.md](docs/SETUP.md).
Release SLO and quality gates live in [docs/RELEASE_GATES.md](docs/RELEASE_GATES.md).

## Common Commands

| Task                                   | Command                        |
| -------------------------------------- | ------------------------------ |
| Start PostgreSQL (pgvector), then wait | `pnpm docker:up`               |
| Start full Inspector stack             | `pnpm docker:inspector:up`     |
| Stop full Inspector stack              | `pnpm docker:inspector:down`   |
| Tail Inspector stack logs              | `pnpm docker:inspector:logs`   |
| Start the MCP server                   | `pnpm --filter mcp-server dev` |
| Start the web app                      | `pnpm --filter web dev`        |
| Start the docs app                     | `pnpm --filter docs dev`       |
| Generate Prisma client                 | `pnpm db:generate`             |
| Run Prisma migrations                  | `pnpm db:migrate`              |
| Open Prisma Studio                     | `pnpm db:studio`               |
| Build all workspaces                   | `pnpm build`                   |
| Lint all workspaces                    | `pnpm lint`                    |
| Type-check all workspaces              | `pnpm typecheck`               |
| Test all workspaces                    | `pnpm test`                    |
| Check documentation links              | `pnpm docs:check`              |
| Format source files                    | `pnpm format`                  |

## Project Layout

| Path                                                             | Purpose                                      |
| ---------------------------------------------------------------- | -------------------------------------------- |
| [apps/mcp-server](apps/mcp-server)                               | Main NestJS MCP server                       |
| [apps/web](apps/web)                                             | Web application workspace                    |
| [apps/docs](apps/docs)                                           | Documentation application workspace          |
| [apps/vscode-copilot-compressor](apps/vscode-copilot-compressor) | VS Code chat compression extension workspace |
| [packages/core](packages/core)                                   | Core MCP types, registry, and tools          |
| [packages/config](packages/config)                               | Environment validation and types             |
| [packages/database](packages/database)                           | Prisma database module                       |
| [packages/vector-store](packages/vector-store)                   | pgvector vector store module                 |
| [packages/embeddings](packages/embeddings)                       | Embedding generation and caching             |
| [packages/memory-stm](packages/memory-stm)                       | Short-term memory package                    |
| [packages/memory-ltm](packages/memory-ltm)                       | Long-term memory package                     |
| [packages/ui](packages/ui)                                       | Shared React components                      |
| [prisma](prisma)                                                 | Prisma schema and migrations                 |
| [docker](docker)                                                 | Local infrastructure initialization          |

## More Information

| Topic                                     | Link                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Detailed local setup and MCP client setup | [docs/SETUP.md](docs/SETUP.md)                                                       |
| Release SLOs and quality gates            | [docs/RELEASE_GATES.md](docs/RELEASE_GATES.md)                                       |
| Current roadmap                           | [docs/roadmap.md](docs/roadmap.md)                                                   |
| Marketing site domain/TLS runbook         | [docs/MARKETING_SITE_DOMAIN.md](docs/MARKETING_SITE_DOMAIN.md)                       |
| MCP server details                        | [apps/mcp-server/README.md](apps/mcp-server/README.md)                               |
| Web app details                           | [apps/web/README.md](apps/web/README.md)                                             |
| Docs app details                          | [apps/docs/README.md](apps/docs/README.md)                                           |
| VS Code compressor extension              | [apps/vscode-copilot-compressor/README.md](apps/vscode-copilot-compressor/README.md) |
| MCP tool development                      | [packages/core/src/mcp/tools/README.md](packages/core/src/mcp/tools/README.md)       |
| Database package                          | [packages/database/README.md](packages/database/README.md)                           |
| Database usage examples                   | [packages/database/USAGE.md](packages/database/USAGE.md)                             |
| Embeddings package                        | [packages/embeddings/README.md](packages/embeddings/README.md)                       |
| Agent and contributor instructions        | [AGENTS.md](AGENTS.md)                                                               |

## Environment

Local defaults live in [.env.example](.env.example). Docker Compose uses these
host port settings by default:

| Service           | Host port setting                   | Purpose                                            |
| ----------------- | ----------------------------------- | -------------------------------------------------- |
| PostgreSQL        | `POSTGRES_PORT`, defaults to `5432` | Primary datastore (memories, vectors, auth state)  |
| Ollama (optional) | `OLLAMA_PORT`, defaults to `11434`  | Local embeddings (`--profile ollama` compose flag) |

When a host port is already in use, update the matching port value and URL in
`.env` before starting Docker. For PostgreSQL, change both `POSTGRES_PORT` and
the port inside `DATABASE_URL`.

## MCP Client Setup

Build the server before connecting it to an MCP client:

```bash
npm exec --yes pnpm@11.5.0 -- build
```

Then copy [claude_desktop_config.json.example](claude_desktop_config.json.example)
to your MCP client configuration location and update the absolute path to
`apps/mcp-server/dist/main.js`. See [docs/SETUP.md](docs/SETUP.md) for the full
client setup flow.

## MCP Inspector

The MCP Inspector has no official Docker image on GHCR — running
`docker run ghcr.io/modelcontextprotocol/inspector:latest` will fail with a
registry error. Use one of the two approaches below instead.

### Option A — host-run (simplest)

With the MCP server already running on `http://localhost:3000`, start the
inspector in a separate terminal:

```bash
npm exec --yes pnpm@11.5.0 -- inspector
```

Then open:

```text
http://localhost:6274/?transport=streamable-http&serverUrl=http%3A%2F%2Flocalhost%3A3000%2Fmcp
```

Port 6274 is the Inspector UI and port 6277 is the proxy. If either port is
already in use (e.g. from a previous run), kill the stale process before
restarting.

### Option B — Docker (inspector in a container)

First ensure the base infrastructure is up (`pnpm docker:up`) and the MCP
server is running on the host. Then start the Inspector container:

```bash
npm exec --yes pnpm@11.5.0 -- docker:inspector:up
```

The container reaches the host-side MCP server via `host.docker.internal`.
Open the Inspector UI at:

```text
http://localhost:6274/?transport=streamable-http&serverUrl=http%3A%2F%2Fhost.docker.internal%3A3000%2Fmcp
```

Stop the container with:

```bash
npm exec --yes pnpm@11.5.0 -- docker:inspector:down
```
