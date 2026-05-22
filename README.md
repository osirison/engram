---
title: ENGRAM
description: Developer setup and project entry points for the ENGRAM MCP memory server
---

## Overview

ENGRAM is a TypeScript monorepo for an MCP memory server. The main runtime is a
NestJS app that connects to PostgreSQL, Redis, and Qdrant for agent memory,
semantic search, and health checks.

## Prerequisites

- Node.js 20 or newer
- pnpm 8 or newer
- Docker and Docker Compose
- Git

## Quick Start

Run these commands from the repository root.

```bash
pnpm install
cp .env.example .env
pnpm docker:up
pnpm db:generate
pnpm db:migrate
pnpm --filter mcp-server dev
```

The MCP server starts on `http://localhost:3000` by default. Check it with:

```bash
curl http://localhost:3000/health
```

To stop local infrastructure without deleting data:

```bash
pnpm docker:down
```

To remove containers and local volumes:

```bash
pnpm docker:clean
```

## Common Commands

| Task                                | Command                        |
| ----------------------------------- | ------------------------------ |
| Start PostgreSQL, Redis, and Qdrant | `pnpm docker:up`               |
| Start the MCP server                | `pnpm --filter mcp-server dev` |
| Start the web app                   | `pnpm --filter web dev`        |
| Start the docs app                  | `pnpm --filter docs dev`       |
| Generate Prisma client              | `pnpm db:generate`             |
| Run Prisma migrations               | `pnpm db:migrate`              |
| Open Prisma Studio                  | `pnpm db:studio`               |
| Build all workspaces                | `pnpm build`                   |
| Lint all workspaces                 | `pnpm lint`                    |
| Type-check all workspaces           | `pnpm typecheck`               |
| Test all workspaces                 | `pnpm test`                    |
| Check documentation links           | `pnpm docs:check`              |
| Format source files                 | `pnpm format`                  |

## Project Layout

| Path                                           | Purpose                             |
| ---------------------------------------------- | ----------------------------------- |
| [apps/mcp-server](apps/mcp-server)             | Main NestJS MCP server              |
| [apps/web](apps/web)                           | Web application workspace           |
| [apps/docs](apps/docs)                         | Documentation application workspace |
| [packages/core](packages/core)                 | Core MCP types, registry, and tools |
| [packages/config](packages/config)             | Environment validation and types    |
| [packages/database](packages/database)         | Prisma database module              |
| [packages/redis](packages/redis)               | Redis client module                 |
| [packages/vector-store](packages/vector-store) | Qdrant vector store module          |
| [packages/embeddings](packages/embeddings)     | Embedding generation and caching    |
| [packages/memory-stm](packages/memory-stm)     | Short-term memory package           |
| [packages/memory-ltm](packages/memory-ltm)     | Long-term memory package            |
| [packages/ui](packages/ui)                     | Shared React components             |
| [prisma](prisma)                               | Prisma schema and migrations        |
| [docker](docker)                               | Local infrastructure initialization |

## More Information

| Topic                                     | Link                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Detailed local setup and MCP client setup | [docs/SETUP.md](docs/SETUP.md)                                                 |
| Current roadmap                           | [docs/roadmap.md](docs/roadmap.md)                                             |
| MCP server details                        | [apps/mcp-server/README.md](apps/mcp-server/README.md)                         |
| Web app details                           | [apps/web/README.md](apps/web/README.md)                                       |
| Docs app details                          | [apps/docs/README.md](apps/docs/README.md)                                     |
| MCP tool development                      | [packages/core/src/mcp/tools/README.md](packages/core/src/mcp/tools/README.md) |
| Database package                          | [packages/database/README.md](packages/database/README.md)                     |
| Database usage examples                   | [packages/database/USAGE.md](packages/database/USAGE.md)                       |
| Redis package                             | [packages/redis/README.md](packages/redis/README.md)                           |
| Embeddings package                        | [packages/embeddings/README.md](packages/embeddings/README.md)                 |
| Agent and contributor instructions        | [AGENTS.md](AGENTS.md)                                                         |

## Environment

Local defaults live in [.env.example](.env.example). The Docker Compose setup
uses these services and ports:

| Service    | Port           | Purpose                             |
| ---------- | -------------- | ----------------------------------- |
| PostgreSQL | `5432`         | Primary relational database         |
| Redis      | `6379`         | Cache and short-term memory support |
| Qdrant     | `6333`, `6334` | Vector search storage               |

## MCP Client Setup

Build the server before connecting it to an MCP client:

```bash
pnpm build
```

Then copy [claude_desktop_config.json.example](claude_desktop_config.json.example)
to your MCP client configuration location and update the absolute path to
`apps/mcp-server/dist/main.js`. See [docs/SETUP.md](docs/SETUP.md) for the full
client setup flow.
