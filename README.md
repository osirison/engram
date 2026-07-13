---
title: ENGRAM
description: Developer setup and project entry points for the ENGRAM MCP memory server
---

## Overview

ENGRAM is a TypeScript monorepo for an MCP memory server. The main runtime is a
NestJS app that connects to PostgreSQL, Redis, and Qdrant for agent memory,
semantic search, and health checks.

## Prerequisites

- Node.js 20 or newer with npm
- Git
- Optional: pnpm 11.5.0 on your `PATH`
- Optional: Docker and Docker Compose v2 (only for `profile-enterprise`)

ENGRAM pins `pnpm@11.5.0` in [package.json](package.json). The quick start
uses npm to run that pinned pnpm version, so it works even when `pnpm` is not
installed globally.

## Choose Your Profile

ENGRAM ships three deployment profiles. Pick the one that matches the
durability, scale, and infrastructure you want. The MCP server reads
`DEPLOYMENT_PROFILE` to decide which modules, health checks, and tools to
expose.

| Profile              | Setup Friction | Durability                             | Scale          | MCP Tool Set                                |
| -------------------- | -------------- | -------------------------------------- | -------------- | ------------------------------------------- |
| `profile-memory`     | Instant        | None (in-process)                      | Single-process | Subset (no reindex or backfill tools)       |
| `profile-lite`       | Medium         | Encrypted-at-rest (AES-256-GCM)        | Single-host    | Subset + synchronous reindex                |
| `profile-enterprise` | Heavy          | Replicated (Postgres + Redis + Qdrant) | Cluster        | Full (sync + queued reindex + cancel/retry) |

The full MCP surface is 26 tools, defined in
[apps/mcp-server/src/memory/tools-manifest.ts](apps/mcp-server/src/memory/tools-manifest.ts)
(the single source of truth for the tool registry). All three profiles share
the same 19-tool core for memory CRUD, promotion, hybrid recall, and the
`remember`/`forget`/`reflect`/`compress_context` helpers; the reindex / queue /
cancel / retry maintenance tools and the Postgres-backed
`export_memories`/`import_agent_memory` tools are profile-gated per the table
above.

### profile-memory — zero-dependency quickstart

In-process memory, no Docker, no Postgres, no Redis, no Qdrant. Best for
demos, CI smoke tests, and exploring the MCP tool surface. Data is lost when
the process exits.

```bash
npm exec --yes pnpm@11.5.0 -- install
DEPLOYMENT_PROFILE=memory npm exec --yes pnpm@11.5.0 -- build
DEPLOYMENT_PROFILE=memory npm exec --yes pnpm@11.5.0 -- --filter mcp-server dev
```

The MCP server starts on `http://localhost:3000`. Check it with:

```bash
curl http://localhost:3000/health
```

### profile-lite — encrypted local durability

AES-256-GCM encrypted file store under `LOCAL_DATA_DIR` (default
`~/.engram/data`). Postgres is the source of truth; Redis and Qdrant are
absent. Best for single-host deployments that need at-rest encryption by
default.

```bash
npm exec --yes pnpm@11.5.0 -- install
# Generate the encryption key once and persist it — reusing the same key
# across commands ensures previously-written records remain decryptable.
echo "LOCAL_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
DEPLOYMENT_PROFILE=lite npm exec --yes pnpm@11.5.0 -- db:migrate
DEPLOYMENT_PROFILE=lite npm exec --yes pnpm@11.5.0 -- build
DEPLOYMENT_PROFILE=lite npm exec --yes pnpm@11.5.0 -- --filter mcp-server dev
```

The server refuses to start in production without `LOCAL_ENCRYPTION_KEY`;
in development it derives an ephemeral key with a loud warning.

### profile-enterprise — full stack

Postgres + Redis + Qdrant with cluster-scale durability, hybrid lexical +
semantic retrieval, and queued reindex / cancel / retry maintenance
tools. Best for production deployments that need horizontal scale,
background jobs, and zero-downtime backfill.

```bash
npm exec --yes pnpm@11.5.0 -- install
test -f .env || cp .env.example .env
npm exec --yes pnpm@11.5.0 -- docker:up
npm exec --yes pnpm@11.5.0 -- db:generate
npm exec --yes pnpm@11.5.0 -- db:migrate
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.5.0 -- build
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.5.0 -- --filter mcp-server dev
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

| Task                                           | Command                        |
| ---------------------------------------------- | ------------------------------ |
| Start PostgreSQL, Redis, and Qdrant, then wait | `pnpm docker:up`               |
| Start full Inspector stack                     | `pnpm docker:inspector:up`     |
| Stop full Inspector stack                      | `pnpm docker:inspector:down`   |
| Tail Inspector stack logs                      | `pnpm docker:inspector:logs`   |
| Start the MCP server                           | `pnpm --filter mcp-server dev` |
| Start the web app                              | `pnpm --filter web dev`        |
| Start the docs app                             | `pnpm --filter docs dev`       |
| Generate Prisma client                         | `pnpm db:generate`             |
| Run Prisma migrations                          | `pnpm db:migrate`              |
| Open Prisma Studio                             | `pnpm db:studio`               |
| Build all workspaces                           | `pnpm build`                   |
| Lint all workspaces                            | `pnpm lint`                    |
| Type-check all workspaces                      | `pnpm typecheck`               |
| Test all workspaces                            | `pnpm test`                    |
| Check documentation links                      | `pnpm docs:check`              |
| Format source files                            | `pnpm format`                  |

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
| [packages/redis](packages/redis)                                 | Redis client module                          |
| [packages/vector-store](packages/vector-store)                   | Qdrant vector store module                   |
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
| Redis package                             | [packages/redis/README.md](packages/redis/README.md)                                 |
| Embeddings package                        | [packages/embeddings/README.md](packages/embeddings/README.md)                       |
| Agent and contributor instructions        | [AGENTS.md](AGENTS.md)                                                               |

## Environment

Local defaults live in [.env.example](.env.example). Docker Compose uses these
host port settings by default:

| Service    | Host port setting                         | Purpose                             |
| ---------- | ----------------------------------------- | ----------------------------------- |
| PostgreSQL | `POSTGRES_PORT`, defaults to `5432`       | Primary relational database         |
| Redis      | `REDIS_PORT`, defaults to `6379`          | Cache and short-term memory support |
| Qdrant     | `QDRANT_HTTP_PORT` and `QDRANT_GRPC_PORT` | Vector search storage               |

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
