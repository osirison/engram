---
title: ENGRAM MCP Server
description: Local development guide for the ENGRAM NestJS MCP server
---

## Overview

The MCP server is the main ENGRAM runtime. It is a NestJS app that exposes
health endpoints and MCP tools backed by PostgreSQL, Redis, Qdrant, and shared
workspace packages.

## Start

Run from the repository root:

```bash
npm exec --yes pnpm@11.4.0 -- install
test -f .env || cp .env.example .env
npm exec --yes pnpm@11.4.0 -- docker:up
npm exec --yes pnpm@11.4.0 -- db:generate
npm exec --yes pnpm@11.4.0 -- db:migrate
npm exec --yes pnpm@11.4.0 -- build
npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

The server listens on `http://localhost:3000` by default.
Command tables use the shorter `pnpm` form after pnpm is installed.

## Environment

Configuration is loaded from the root `.env` file. The most important values
are:

| Variable             | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `PORT`               | HTTP port, defaults to `3000`                        |
| `DATABASE_URL`       | PostgreSQL connection string                         |
| `REDIS_URL`          | Redis connection string                              |
| `QDRANT_URL`         | Qdrant HTTP URL                                      |
| `OPENAI_API_KEY`     | Optional key for remote embeddings                   |
| `EMBEDDING_PROVIDER` | Embedding provider: `openai`, `local`, or `disabled` |

## Commands

| Task                      | Command                                    |
| ------------------------- | ------------------------------------------ |
| Start development server  | `pnpm --filter mcp-server dev`             |
| Build                     | `pnpm --filter mcp-server build`           |
| Start built server        | `pnpm --filter mcp-server start:prod`      |
| Run lint                  | `pnpm --filter mcp-server lint`            |
| Type-check                | `pnpm --filter mcp-server typecheck`       |
| Run unit tests            | `pnpm --filter mcp-server test`            |
| Run coverage              | `pnpm --filter mcp-server test:cov`        |
| Run e2e tests with Docker | `pnpm --filter mcp-server test:e2e:docker` |
| Reindex memory embeddings | `pnpm --filter mcp-server reindex`         |

## Reindex / Backfill

The server exposes a `reindex_memories` MCP tool and a standalone CLI that
backfill long-term memory vector embeddings. Use them after enabling a new
vector backend, changing the embedding model, or recovering from a vector store
outage.

The `reindex_memories` tool accepts optional `userId` (scopes the run to one
user), `batchSize` (1-1000), `reuseExistingEmbeddings` (reuse stored vectors
instead of regenerating), `cursor` (resume from a previous run), and
`maxMemories` (cap the number processed). It returns a summary of processed,
indexed, skipped, and failed counts plus the next `cursor`.

Run the CLI directly:

```bash
pnpm --filter mcp-server reindex -- --user <userId> --batch-size 200
pnpm --filter mcp-server reindex -- --regenerate --max 1000
```

| Flag           | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `--user`       | Restrict reindexing to a single user id            |
| `--batch-size` | Memories to process per batch (1-1000)             |
| `--max`        | Maximum number of memories to process              |
| `--cursor`     | Resume from a memory id returned by a previous run |
| `--regenerate` | Regenerate embeddings instead of reusing stored    |

## Health Endpoints

| Endpoint              | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `GET /health`         | Reports database, Redis, and Qdrant health           |
| `GET /health/metrics` | Returns embedding counters in Prometheus text format |

Check the server locally:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/metrics
```

## Related Docs

- Root setup: [../../README.md](../../README.md)
- Detailed setup: [../../docs/SETUP.md](../../docs/SETUP.md)
- MCP tool development: [../../packages/core/src/mcp/tools/README.md](../../packages/core/src/mcp/tools/README.md)
