---
title: ENGRAM MCP Server
description: Local development guide and profile-aware MCP tool reference for the ENGRAM NestJS MCP server
---

## Overview

The MCP server is the main ENGRAM runtime. It is a NestJS app that exposes
health endpoints and MCP tools backed by PostgreSQL, Redis, Qdrant, and
shared workspace packages. The active runtime is selected by the
`DEPLOYMENT_PROFILE` environment variable; see
[Root README](../../README.md) for an overview and
[docs/SETUP.md](../../docs/SETUP.md) for the per-profile setup flow.

## Start

The command shape is the same for every profile. Only the
`DEPLOYMENT_PROFILE` value and the optional `LOCAL_ENCRYPTION_KEY`
change.

```bash
# profile-memory (no external services)
DEPLOYMENT_PROFILE=memory npm exec --yes pnpm@11.4.0 -- install
DEPLOYMENT_PROFILE=memory npm exec --yes pnpm@11.4.0 -- build
DEPLOYMENT_PROFILE=memory npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

```bash
# profile-lite (Postgres + encrypted local store)
DEPLOYMENT_PROFILE=lite \
LOCAL_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  npm exec --yes pnpm@11.4.0 -- db:migrate
DEPLOYMENT_PROFILE=lite \
LOCAL_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  npm exec --yes pnpm@11.4.0 -- build
DEPLOYMENT_PROFILE=lite \
LOCAL_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

```bash
# profile-enterprise (Postgres + Redis + Qdrant)
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- install
test -f .env || cp .env.example .env
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- docker:up
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- db:generate
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- db:migrate
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- build
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

The server listens on `http://localhost:3000` by default. Command
tables use the shorter `pnpm` form after pnpm is installed.

## MCP Tool Availability by Profile

All 19 MCP tools are wired in every profile. The table below marks
whether a tool is exposed in the active `MCP` tool registry. Tools that
are hidden are still callable via the underlying controller for
operators, but are not advertised to MCP clients.

| Tool                     | Memory | Lite | Enterprise | Notes                                                   |
| ------------------------ | :----: | :--: | :--------: | ------------------------------------------------------- |
| `create_memory`          |   ✅   |  ✅  |     ✅     | Always available                                        |
| `get_memory`             |   ✅   |  ✅  |     ✅     | Always available                                        |
| `list_memories`          |   ✅   |  ✅  |     ✅     | Always available                                        |
| `update_memory`          |   ✅   |  ✅  |     ✅     | Always available                                        |
| `delete_memory`          |   ✅   |  ✅  |     ✅     | Always available                                        |
| `promote_memory`         |   ✅   |  ✅  |     ✅     | Always available                                        |
| `recall`                 |   ✅   |  ✅  |     ✅     | Hybrid lexical + semantic when embeddings present       |
| `reindex_memories`       |   ❌   |  ✅  |     ✅     | Admin tool. Hidden in `memory` (no vector store).       |
| `queue_reindex_memories` |   ❌   |  ❌  |     ✅     | Requires BullMQ / Redis. Hidden in `memory` and `lite`. |
| `get_reindex_status`     |   ✅   |  ✅  |     ✅     | Status is read-only, available in every profile.        |
| `cancel_reindex_job`     |   ❌   |  ❌  |     ✅     | Requires a queued job. Hidden in `memory` and `lite`.   |
| `retry_reindex_job`      |   ✅   |  ✅  |     ✅     | Replays a saved cursor regardless of profile.           |
| `consolidate_memories`   |   ✅   |  ✅  |     ✅     | Admin tool. No-op when the STM store is in-process.     |
| `remember`               |   ✅   |  ✅  |     ✅     | Always available                                        |
| `forget`                 |   ✅   |  ✅  |     ✅     | Always available                                        |
| `reflect`                |   ✅   |  ✅  |     ✅     | Always available                                        |
| `compress_context`       |   ✅   |  ✅  |     ✅     | Always available                                        |
| `load_context`           |   ✅   |  ✅  |     ✅     | Always available                                        |
| `ingest_conversation`    |   ✅   |  ✅  |     ✅     | Always available                                        |

The filter is implemented in
`apps/mcp-server/src/memory/memory.controller.ts` (`filterToolsByProfile`).
Tool callers that need a tool hidden in their profile can still call
the controller method directly via the Nest HTTP layer.

## Health and Readiness Semantics

`/health` and `/health/ready` always include the process-level
`memory-store` indicator (pid, uptime, heap). Additional dependency
indicators are added only when the active profile requires them:

| Indicator | Memory | Lite | Enterprise | What it reports                          |
| --------- | :----: | :--: | :--------: | ---------------------------------------- |
| process   |   ✅   |  ✅  |     ✅     | pid, uptime, heap — always present       |
| database  |   ❌   |  ✅  |     ✅     | Prisma `SELECT 1` against `DATABASE_URL` |
| redis     |   ❌   |  ❌  |     ✅     | `PING` against `REDIS_URL`               |
| qdrant    |   ❌   |  ❌  |     ✅     | `GET /` against `QDRANT_URL`             |
| pgvector  |   ❌   |  ❌  |    ✅\*    | Only when `VECTOR_BACKEND=pgvector`      |

`/health/ready` reports the same indicator set; it is appropriate as a
Kubernetes readiness probe because the indicator list is the minimum
set required to serve traffic in the active profile.

`/health/metrics` is a Prometheus text endpoint that always emits:

- `engram_vector_backend_info{backend=...}` (value `1`).
- `engram_pgvector_ready 0|1` (only emitted in `profile-enterprise` when
  the pgvector backend is active).
- `engram_deployment_profile_info{profile="memory|lite|enterprise"} 1`.

When the embeddings service is registered, the metrics endpoint also
emits the embedding counters from `EmbeddingsService.getPrometheusMetrics()`.

## Reindex / Backfill

The server exposes `reindex_memories`, `queue_reindex_memories`,
`get_reindex_status`, `cancel_reindex_job`, and `retry_reindex_job`
MCP tools plus a standalone CLI that backfill long-term memory vector
embeddings. Use them after enabling a new vector backend, changing the
embedding model, or recovering from a vector store outage.

Maintenance tools are admin-guarded: each call must include
`adminToken`, and the server validates it against `MCP_ADMIN_TOKEN`
using a constant-time comparison and emits
`admin_auth_ok` / `admin_auth_denied` audit log lines.

The `reindex_memories` tool accepts optional `userId` (scopes the run
to one user), `batchSize` (1-1000), `reuseExistingEmbeddings` (reuse
stored vectors instead of regenerating), `cursor` (resume from a
previous run), and `maxMemories` (cap the number processed). It returns
a summary of processed, indexed, skipped, and failed counts plus the
next resumable `cursor`.

For large datasets, `queue_reindex_memories` enqueues a background
reindex job and returns a `jobId`; poll `get_reindex_status` with the
same id to observe state (`queued`, `running`, `completed`, `failed`,
`cancelled`) and cumulative progress. Use `cancel_reindex_job` to
request cancellation and `retry_reindex_job` to continue from the last
saved cursor.

Run the CLI directly:

```bash
npm exec --yes pnpm@11.4.0 -- --filter mcp-server reindex -- --user <userId> --batch-size 200
npm exec --yes pnpm@11.4.0 -- --filter mcp-server reindex -- --regenerate --max 1000
```

| Flag           | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `--user`       | Restrict reindexing to a single user id            |
| `--batch-size` | Memories to process per batch (1-1000)             |
| `--max`        | Maximum number of memories to process              |
| `--cursor`     | Resume from a memory id returned by a previous run |
| `--regenerate` | Regenerate embeddings instead of reusing stored    |

## Migration Tools

The migration tooling promotes a `profile-lite` deployment to
`profile-enterprise` with dual-write, cursor-resumable backfill, and
SHA-256 content-hash verification before cutover. The state machine is
`idle → preparing → copying → verifying → cutting_over → complete |
rollback` and is enforced by `MigrationStateService` in
`apps/mcp-server/src/migration/`.

| Command                                                                     | Purpose                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm --filter mcp-server dev` with `LOCAL_ENCRYPTION_KEY=<source-key>` set | Boot the dual-write coordinator                                                 |
| `pnpm --filter mcp-server verify-migration`                                 | Run the per-user + global count + hash check; advance to `cutting_over` on pass |
| `pnpm --filter mcp-server cutover-migration`                                | Advance the state machine to `complete`                                         |
| `pnpm --filter mcp-server abort-migration`                                  | Roll the state machine back to `rollback` (source remains readable)             |
| `pnpm --filter mcp-server reindex` (see above)                              | Reindex after a cutover or vector-store rebuild                                 |

Prerequisites for migration:

- `DEPLOYMENT_PROFILE=enterprise` is the active profile on the new host.
- `LOCAL_ENCRYPTION_KEY` matches the source `profile-lite` key.
- `MCP_ADMIN_TOKEN` is set so the dual-write / verifier logs are
  attributed correctly.
- The hard-stop fraction defaults to `0.00001` (one ten-thousandth of
  a percent). Any per-user count or content-hash mismatch above this
  fraction auto-aborts to `rollback`.

## Environment

Configuration is loaded from the root `.env` file. The most important
values are:

| Variable               | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `DEPLOYMENT_PROFILE`   | Profile selector: `memory`, `lite`, or `enterprise`             |
| `PORT`                 | HTTP port, defaults to `3000`                                   |
| `DATABASE_URL`         | PostgreSQL connection string (required for `lite`+`enterprise`) |
| `REDIS_URL`            | Redis connection string (required for `enterprise`)             |
| `QDRANT_URL`           | Qdrant HTTP URL (required for `enterprise`)                     |
| `VECTOR_BACKEND`       | `qdrant` (default) or `pgvector`                                |
| `LOCAL_DATA_DIR`       | `profile-lite` data directory (default `~/.engram/data`)        |
| `LOCAL_ENCRYPTION_KEY` | `profile-lite` 32-byte base64 AES-256 key                       |
| `OPENAI_API_KEY`       | Optional key for remote embeddings                              |
| `EMBEDDING_PROVIDER`   | Embedding provider: `openai`, `local`, or `disabled`            |
| `MCP_ADMIN_TOKEN`      | Required token for admin maintenance MCP tools                  |
| `MCP_TRANSPORT`        | MCP transport: `stdio` or `streamable-http`                     |

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

## Health Endpoints

| Endpoint              | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `GET /health`         | Reports process, database, Redis, and Qdrant health  |
| `GET /health/ready`   | Readiness probe using the same backend health checks |
| `GET /health/metrics` | Returns embedding counters in Prometheus text format |

Check the server locally:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
curl http://localhost:3000/health/metrics
```

## Inspector Testing

Run ENGRAM locally with Streamable HTTP:

```bash
DEPLOYMENT_PROFILE=enterprise \
MCP_TRANSPORT=streamable-http \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

Then run MCP Inspector externally (outside this repo) and connect to:

```text
http://host.docker.internal:3000/mcp
```

Full external-container launch instructions are in
[../../docs/SETUP.md](../../docs/SETUP.md).

## Related Docs

- Root setup: [../../README.md](../../README.md)
- Detailed setup: [../../docs/SETUP.md](../../docs/SETUP.md)
- Release SLOs and quality gates: [../../docs/RELEASE_GATES.md](../../docs/RELEASE_GATES.md)
- MCP tool development: [../../packages/core/src/mcp/tools/README.md](../../packages/core/src/mcp/tools/README.md)
