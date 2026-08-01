---
title: ENGRAM Developer Guide
description: Install, run, configure, and connect the ENGRAM MCP memory server — profiles, commands, MCP client setup, and the Inspector.
---

The [README](../README.md) gets you running in one command. This guide is the
in-repo reference for everything underneath it: prerequisites, the deployment
profiles, manual setup, the command surface, connecting an MCP client, and the
MCP Inspector.

The full documentation site lives at
[engram.events/docs](https://engram.events/docs/).

## The one-command installer

From a fresh clone, [`scripts/install.sh`](../scripts/install.sh) does the whole
setup — copies `.env`, installs dependencies, starts PostgreSQL, runs migrations,
and builds:

```bash
./scripts/install.sh            # lite profile (default), then prints the start command
./scripts/install.sh --start    # same, then launches the server on :3000
./scripts/install.sh --standard # multi-tenant profile (auth, API keys, rate limits)
```

It is idempotent — re-run it any time. If you don't have Docker, point
`DATABASE_URL` at your own PostgreSQL (with the `pgvector` extension) and the
installer skips the bundled container.

## Prerequisites

- Node.js 20 or newer with npm
- Git
- Optional: `pnpm@11.5.0` on your `PATH`
- Optional: Docker and Docker Compose v2 — to run the bundled PostgreSQL
  container (image `pgvector/pgvector:pg16+`)

ENGRAM pins `pnpm@11.5.0` in [package.json](../package.json). Every command below
uses `pnpm`; when `pnpm` is not on your `PATH`, replace the leading `pnpm` with
`npm exec --yes pnpm@11.5.0 --`. For example, `pnpm install` becomes
`npm exec --yes pnpm@11.5.0 -- install`.

## Deployment profiles

ENGRAM ships two profiles. **Both run on PostgreSQL alone** — the same storage,
vectors (pgvector), and durability — and both expose the full MCP tool set,
including the queued reindex / cancel / retry maintenance tools. The server reads
`DEPLOYMENT_PROFILE`; when it is unset, `standard` is the default.

| Profile            | `DEPLOYMENT_PROFILE` | Tenancy                                                   | Backing services      |
| ------------------ | -------------------- | --------------------------------------------------------- | --------------------- |
| Lite               | `lite`               | Single user — auth/organization stack not wired           | PostgreSQL (pgvector) |
| Standard (default) | `standard`           | Multi-tenant — auth, API keys, organizations, rate limits | PostgreSQL (pgvector) |

The legacy value `enterprise` is accepted as an alias for `standard`. The old
`memory` profile was removed — every profile now runs on Postgres, so the server
rejects `DEPLOYMENT_PROFILE=memory` with guidance to pick `lite` or `standard`.

- **Lite** — best for a personal machine running a local memory server. Same
  durable Postgres storage as `standard`, minus the multi-tenant auth/organization
  stack, so there is no login or API-key surface to configure.
- **Standard** — best for shared or production deployments. Adds JWT sessions,
  per-agent API keys, organizations, and Postgres-backed rate limiting on top of
  the same storage.

## Manual setup

If you'd rather not use the installer, run the steps yourself. Both profiles use
the same flow; only the profile passed to `build` (and to the server at runtime)
differs.

### Lite (single-user)

```bash
pnpm install
test -f .env || cp .env.example .env
pnpm docker:up
pnpm db:generate
pnpm db:migrate:deploy
DEPLOYMENT_PROFILE=lite pnpm build
DEPLOYMENT_PROFILE=lite pnpm --filter mcp-server dev
```

### Standard (multi-tenant, default)

```bash
pnpm install
test -f .env || cp .env.example .env
pnpm docker:up
pnpm db:generate
pnpm db:migrate:deploy
pnpm build
pnpm --filter mcp-server dev
```

The MCP server starts on `http://localhost:3000`. Verify it in a second terminal:

```bash
curl http://localhost:3000/health
```

Stop the database without deleting data with `pnpm docker:down`; remove the
containers and local volumes with `pnpm docker:clean`.

## Common commands

| Task                                   | Command                        |
| -------------------------------------- | ------------------------------ |
| Start PostgreSQL (pgvector), then wait | `pnpm docker:up`               |
| Stop the database, keep data           | `pnpm docker:down`             |
| Stop the database, delete data         | `pnpm docker:clean`            |
| Start the MCP server                   | `pnpm --filter mcp-server dev` |
| Start the web app                      | `pnpm --filter web dev`        |
| Start the docs app                     | `pnpm --filter docs dev`       |
| Generate Prisma client                 | `pnpm db:generate`             |
| Deploy migrations (unattended)         | `pnpm db:migrate:deploy`       |
| Create a dev migration                 | `pnpm db:migrate`              |
| Open Prisma Studio                     | `pnpm db:studio`               |
| Build all workspaces                   | `pnpm build`                   |
| Lint all workspaces                    | `pnpm lint`                    |
| Type-check all workspaces              | `pnpm typecheck`               |
| Test all workspaces                    | `pnpm test`                    |
| Check documentation links              | `pnpm docs:check`              |
| Format source files                    | `pnpm format`                  |

## Environment

Local defaults live in [.env.example](../.env.example). Docker Compose uses these
host ports by default:

| Service           | Host port setting                   | Purpose                                            |
| ----------------- | ----------------------------------- | -------------------------------------------------- |
| PostgreSQL        | `POSTGRES_PORT`, defaults to `5432` | Primary datastore (memories, vectors, auth state)  |
| Ollama (optional) | `OLLAMA_PORT`, defaults to `11434`  | Local embeddings (`--profile ollama` compose flag) |

When a host port is already in use, update the matching port value and URL in
`.env` before starting Docker. For PostgreSQL, change both `POSTGRES_PORT` and the
port inside `DATABASE_URL`.

### Embeddings

The embedding provider is selected by `EMBEDDING_PROVIDER`:

- `ollama` (default) — a local Ollama server, no API key. Install Ollama
  ([ollama.com/download](https://ollama.com/download)) and run
  `ollama pull nomic-embed-text`, or start the bundled container with
  `docker compose --profile ollama up -d`.
- `openai` — requires `OPENAI_API_KEY`.
- `local` — a deterministic hash provider, for testing.
- `disabled` — no embeddings.

When no provider is reachable, writes still succeed: memories are stored without
a vector and can be backfilled later with a reindex. See
[.env.example](../.env.example) for the full list of embedding variables.

## MCP client setup

Build the server before connecting a client:

```bash
pnpm build
```

### Claude Desktop (stdio)

Claude Desktop spawns the server as a subprocess. Copy the example config from
the repository root:

```bash
cp claude_desktop_config.json.example claude_desktop_config.json
```

Edit the `args` path to the absolute location of
`apps/mcp-server/dist/main.js` in your checkout:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/absolute/path/to/your/engram/apps/mcp-server/dist/main.js"],
      "env": {
        "DATABASE_URL": "postgresql://engram:dev_password@localhost:5432/engram",
        "DEPLOYMENT_PROFILE": "lite",
        "NODE_ENV": "production"
      }
    }
  }
}
```

Copy the file into Claude Desktop's config location and restart the client:

| Operating system | Config path                                                       |
| ---------------- | ----------------------------------------------------------------- |
| Linux            | `~/.config/Claude/claude_desktop_config.json`                     |
| macOS            | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows          | `%APPDATA%\Claude\claude_desktop_config.json`                     |

Then ask the client to call the `ping` tool to confirm connectivity.

### Claude Code (Streamable HTTP)

To share one persistent server across sessions and agents, run it with
`MCP_TRANSPORT=streamable-http` and register it in the repository's `.mcp.json`:

```json
{
  "mcpServers": {
    "engram": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer ${ENGRAM_API_KEY:-}"
      }
    }
  }
}
```

The `${ENGRAM_API_KEY:-}` default keeps the file parseable when the key is unset.

### Authentication (read before sharing a server)

- `AUTH_REQUIRED` defaults to **`false`**. A single-user stdio server spawned by
  your own client needs no key, and the `lite` profile is single-user, so the
  auth gate does not apply to it.
- On the multi-tenant `standard` profile, a Streamable HTTP server **refuses to
  start without `AUTH_REQUIRED=true`** in every `NODE_ENV`, unless the operator
  explicitly sets `ALLOW_UNAUTHENTICATED_HTTP=true` — an acknowledged
  trusted-network escape hatch (for example a loopback-bound, single-operator
  host). Without a gate, the tenant `userId` is read from the request body and is
  spoofable by any process that can reach the port.
- Recommended posture for any shared server: `AUTH_REQUIRED=true`, one
  least-privilege API key per agent, and a loopback (`127.0.0.1`) bind. Setting
  `AUTH_REQUIRED=true` also requires a `JWT_SECRET` of at least 32 characters.

For an HTTP server, the repository's verification script checks the full MCP
handshake and the auth gate:

```bash
AUTH_REQUIRED=true ./scripts/verify-engram-server.sh
```

## MCP Inspector

The MCP Inspector has no official Docker image on GHCR — running
`docker run ghcr.io/modelcontextprotocol/inspector:latest` will fail with a
registry error. Use one of the two approaches below instead.

### Option A — host-run (simplest)

With the MCP server already running on `http://localhost:3000`, start the
Inspector in a separate terminal:

```bash
pnpm inspector
```

Then open:

```text
http://localhost:6274/?transport=streamable-http&serverUrl=http%3A%2F%2Flocalhost%3A3000%2Fmcp
```

Port 6274 is the Inspector UI and port 6277 is the proxy. If either port is
already in use (for example from a previous run), kill the stale process before
restarting.

### Option B — Docker (Inspector in a container)

First ensure the base infrastructure is up (`pnpm docker:up`) and the MCP server
is running on the host. Then start the Inspector container:

```bash
pnpm docker:inspector:up
```

The container reaches the host-side MCP server via `host.docker.internal`. Open
the Inspector UI at:

```text
http://localhost:6274/?transport=streamable-http&serverUrl=http%3A%2F%2Fhost.docker.internal%3A3000%2Fmcp
```

Stop the container with `pnpm docker:inspector:down`.

## Reindex and backfill

After changing the embedding model or its dimensionality, rebuild the vector
index from Postgres (the source of truth). The admin MCP tools
(`reindex_memories`, `queue_reindex_memories`, and friends) require an
`adminToken` matching `MCP_ADMIN_TOKEN`; there is also a CLI:

```bash
pnpm --filter mcp-server reindex --recreate --regenerate
```

`--recreate` drops the old index and rebuilds it at the new dimensionality;
`--regenerate` recomputes embeddings and writes them back to Postgres. The CLI is
cursor-resumable (`--cursor <id>`).

## Project layout

| Path                                              | Purpose                                     |
| ------------------------------------------------- | ------------------------------------------- |
| [apps/mcp-server](../apps/mcp-server)             | Main NestJS MCP server                      |
| [apps/web](../apps/web)                           | Web application workspace                   |
| [apps/docs](../apps/docs)                         | Documentation site workspace                |
| [packages/core](../packages/core)                 | Core MCP types, registry, and tools         |
| [packages/config](../packages/config)             | Environment validation and profile taxonomy |
| [packages/database](../packages/database)         | Prisma database module                      |
| [packages/vector-store](../packages/vector-store) | pgvector vector store module                |
| [packages/embeddings](../packages/embeddings)     | Embedding generation                        |
| [packages/memory-stm](../packages/memory-stm)     | Short-term memory package                   |
| [packages/memory-ltm](../packages/memory-ltm)     | Long-term memory package                    |
| [prisma](../prisma)                               | Prisma schema and migrations                |
| [docker](../docker)                               | Local infrastructure initialization         |

## More information

| Topic                                   | Link                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| Full documentation site                 | [engram.events/docs](https://engram.events/docs/)                                 |
| Agent and contributor instructions      | [AGENTS.md](../AGENTS.md)                                                         |
| Shared memory contract for agent fleets | [agent-memory-contract.md](agent-memory-contract.md)                              |
| Release SLOs and quality gates          | [RELEASE_GATES.md](RELEASE_GATES.md)                                              |
| Current roadmap                         | [roadmap.md](roadmap.md)                                                          |
| MCP server details                      | [apps/mcp-server/README.md](../apps/mcp-server/README.md)                         |
| MCP tool development                    | [packages/core/src/mcp/tools/README.md](../packages/core/src/mcp/tools/README.md) |
