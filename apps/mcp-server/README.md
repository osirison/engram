---
title: ENGRAM MCP Server
description: Local development guide and MCP tool reference for the ENGRAM NestJS MCP server
---

## Overview

The MCP server is the main ENGRAM runtime. It is a NestJS app that exposes
health endpoints and MCP tools backed by PostgreSQL (with the pgvector
extension) and shared workspace packages. PostgreSQL is the only backing
service — vectors, short-term memory, sessions, and rate limits all live in it.
The active runtime is selected by the `DEPLOYMENT_PROFILE` environment
variable; see [Root README](../../README.md) for an overview and
[docs/SETUP.md](../../docs/SETUP.md) for the per-profile setup flow.

## Profiles

There are exactly two deployment profiles, and both run on Postgres alone:

| Profile    | Tenancy                                              | Auth stack |
| ---------- | ---------------------------------------------------- | ---------- |
| `standard` | Multi-tenant (default) — API keys, orgs, rate limits | wired      |
| `lite`     | Single-user                                          | not wired  |

`standard` is the default. The value `enterprise` is accepted as a deprecated
alias for `standard`. Both profiles use the same storage; `lite` simply leaves
the multi-tenant auth/organization stack unwired.

## Start

The command shape is the same for every profile — only the
`DEPLOYMENT_PROFILE` value changes.

```bash
# standard (default, multi-tenant)
pnpm install
test -f .env || cp .env.example .env
pnpm docker:up                 # starts PostgreSQL (pgvector image)
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm --filter mcp-server dev
```

```bash
# lite (single-user) — identical steps, only the profile differs
DEPLOYMENT_PROFILE=lite pnpm --filter mcp-server dev
```

The server listens on `http://localhost:3000` by default.

## MCP Tools

Every MCP tool is wired in both profiles. Because both are Postgres-backed and
DB-bearing, there is no profile-based tool gating — the full surface is
identical in `lite` and `standard`. The authoritative list lives in
`apps/mcp-server/src/memory/tools-manifest.ts`; the current groups are:

- **CRUD & lifecycle** — `create_memory`, `get_memory`, `list_memories`,
  `update_memory`, `delete_memory`, `bulk_delete_memories`, `promote_memory`,
  `restore_memory`, `reembed_memory`, `get_memory_audit`.
- **Retrieval & context** — `recall`, `load_context`, `prompt_context`,
  `compress_context`.
- **Agent-memory contract** — `remember`, `forget`, `reflect`,
  `ingest_conversation`.
- **Consolidation** — `consolidate_memories`, `consolidate_corpus`.
- **Import / export** — `export_memories`, `import_agent_memory`.
- **Reindex / backfill (admin-guarded)** — `reindex_memories`,
  `queue_reindex_memories`, `get_reindex_status`, `cancel_reindex_job`,
  `retry_reindex_job`.

A few tools (`export_memories`, `import_agent_memory`, `consolidate_corpus`)
are advertised only when their Postgres-backed services are registered — this
is gated on **service presence**, not on the profile, and both profiles supply
those services by default.

## Health and Readiness Semantics

`/health` and `/health/ready` always include the process-level `memory-store`
indicator (pid, uptime, heap). Because both profiles are DB-bearing, both also
add the `database` and `pgvector` indicators:

| Indicator      | What it reports                                        |
| -------------- | ------------------------------------------------------ |
| `memory-store` | pid, uptime, heap — always present                     |
| `database`     | Prisma `SELECT 1` against `DATABASE_URL`               |
| `pgvector`     | Reachability of the pgvector extension / vector column |

`/health/ready` reports the same indicator set; it is appropriate as a
Kubernetes readiness probe because the indicator list is the minimum set
required to serve traffic.

`/health/metrics` is a Prometheus text endpoint that always emits:

- `engram_vector_backend_info{backend="pgvector"} 1`.
- `engram_pgvector_ready 0|1`.
- `engram_deployment_profile_info{profile="lite|standard"} 1`.

When the embeddings service is registered, the metrics endpoint also emits the
embedding counters from `EmbeddingsService.getPrometheusMetrics()`. If
`METRICS_TOKEN` is set, the endpoint requires a matching bearer token.

## Reindex / Backfill

The server exposes `reindex_memories`, `queue_reindex_memories`,
`get_reindex_status`, `cancel_reindex_job`, and `retry_reindex_job` MCP tools
plus a standalone CLI that backfill long-term memory vector embeddings. Use them
after changing the embedding model or dimensionality, or when recovering the
vector index from an outage.

Maintenance tools are admin-guarded: each call must include `adminToken`, and
the server validates it against `MCP_ADMIN_TOKEN` using a constant-time
comparison and emits `admin_auth_ok` / `admin_auth_denied` audit log lines.

The `reindex_memories` tool accepts optional `userId` (scopes the run to one
user), `batchSize` (1-1000), `reuseExistingEmbeddings` (reuse stored vectors
instead of regenerating), `recreate` (drop and rebuild the whole vector index
first — unscoped full reindex only), `cursor` (resume from a previous run), and
`maxMemories` (cap the number processed). It returns a summary of processed,
indexed, skipped, and failed counts plus the next resumable `cursor`.

For large datasets, `queue_reindex_memories` enqueues a background reindex job
and returns a `jobId`. The queue is **Postgres-backed**: the job row, its
cumulative progress, and the resume cursor persist in Postgres, and jobs run one
at a time. Poll `get_reindex_status` with the same id to observe state
(`queued`, `running`, `completed`, `failed`, `cancelled`) and progress. Use
`cancel_reindex_job` to request cancellation and `retry_reindex_job` to continue
from the last saved cursor.

Run the CLI directly:

```bash
pnpm --filter mcp-server reindex -- --user <userId> --batch-size 200
pnpm --filter mcp-server reindex -- --recreate --regenerate --max 1000
```

| Flag           | Purpose                                                     |
| -------------- | ----------------------------------------------------------- |
| `--user`       | Restrict reindexing to a single user id                     |
| `--batch-size` | Memories to process per batch (1-1000)                      |
| `--regenerate` | Regenerate embeddings instead of reusing stored             |
| `--recreate`   | Drop and rebuild the whole vector index (unscoped full run) |
| `--max`        | Maximum number of memories to process                       |
| `--cursor`     | Resume from a memory id returned by a previous run          |

After an embedding model or dimensionality change, run an **unscoped** full
reindex with `--recreate --regenerate` — it drops the old index, regenerates at
the new dimensionality, and writes the regenerated embeddings back to Postgres.

## Environment

Configuration is loaded from the root `.env` file. The most important values
are:

| Variable                        | Purpose                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| `DEPLOYMENT_PROFILE`            | Profile selector: `lite` or `standard` (default)                |
| `PORT`                          | HTTP port, defaults to `3000`                                   |
| `HOST`                          | Bind address (default `0.0.0.0`; use `127.0.0.1` for loopback)  |
| `DATABASE_URL`                  | PostgreSQL connection string (required)                         |
| `AUTH_REQUIRED`                 | Enforce per-agent API keys (multi-tenant `standard`)            |
| `EMBEDDING_PROVIDER`            | `ollama` (default), `openai`, `local`, or `disabled`            |
| `EMBEDDING_MODEL`               | Model id; defaults per provider (`nomic-embed-text` for ollama) |
| `OLLAMA_URL`                    | Ollama server URL (default `http://localhost:11434`)            |
| `OPENAI_API_KEY`                | Required only when `EMBEDDING_PROVIDER=openai`                  |
| `VECTOR_DIMENSIONS`             | Optional strict pin for the vector index dimensionality         |
| `PGVECTOR_HNSW_M`               | HNSW graph degree (index tuning)                                |
| `PGVECTOR_HNSW_EF_CONSTRUCTION` | HNSW build-time candidate list size                             |
| `PGVECTOR_HNSW_EF_SEARCH`       | HNSW query-time candidate list size                             |
| `STM_SWEEP_INTERVAL_MS`         | Interval for the short-term-memory expiry sweep                 |
| `MCP_ADMIN_TOKEN`               | Required token for admin maintenance MCP tools                  |
| `MCP_TRANSPORT`                 | MCP transport: `stdio` or `streamable-http`                     |
| `METRICS_TOKEN`                 | Optional bearer token guarding `/health/metrics`                |

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

| Endpoint              | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `GET /health`         | Reports process, database, and pgvector health             |
| `GET /health/ready`   | Readiness probe using the same indicator set               |
| `GET /health/metrics` | Prometheus text: profile, pgvector, and embedding counters |

Check the server locally:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
curl http://localhost:3000/health/metrics
```

## Inspector Testing

Run ENGRAM locally with Streamable HTTP:

```bash
MCP_TRANSPORT=streamable-http pnpm --filter mcp-server dev
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
