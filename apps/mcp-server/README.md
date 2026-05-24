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
npm exec --yes pnpm@8.15.0 -- install
test -f .env || cp .env.example .env
npm exec --yes pnpm@8.15.0 -- docker:up
npm exec --yes pnpm@8.15.0 -- db:generate
npm exec --yes pnpm@8.15.0 -- db:migrate
npm exec --yes pnpm@8.15.0 -- build
npm exec --yes pnpm@8.15.0 -- --filter mcp-server dev
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
