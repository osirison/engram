---
title: ENGRAM Setup
description: Local development, MCP client setup, and profile migration runbook for ENGRAM
---

## Prerequisites

Install these tools before starting:

- Node.js 20 or newer with npm
- Git
- Optional: pnpm 11.4.0 on your `PATH`
- Optional: Docker and Docker Compose v2 (only for `profile-enterprise`)
- Optional: `openssl` (for generating `LOCAL_ENCRYPTION_KEY` for `profile-lite`)

The repository pins `pnpm@11.4.0`. When `pnpm` is not installed, replace the
leading `pnpm` in any command with `npm exec --yes pnpm@11.4.0 --`.

## Choose Your Profile

ENGRAM runs in one of three profiles, selected by the `DEPLOYMENT_PROFILE`
environment variable. Pick the profile that matches the durability, scale,
and infrastructure you want before running any commands.

| Profile              | `DEPLOYMENT_PROFILE` | External dependencies     | Use it for                                         |
| -------------------- | -------------------- | ------------------------- | -------------------------------------------------- |
| Memory               | `memory`             | None                      | Demos, CI smoke tests, exploring the MCP surface   |
| Lite                 | `lite`               | Postgres only             | Single-host deployments needing at-rest encryption |
| Enterprise (default) | `enterprise`         | Postgres + Redis + Qdrant | Production, cluster scale, queued reindex          |

All commands in this document include the `DEPLOYMENT_PROFILE=...` prefix
so the same line works in every mode. The rest of the setup differs by
profile.

## Memory Profile

The Memory profile boots with no external services. STM and LTM are
in-process; embeddings degrade to lexical-only when no provider is
configured. Data is lost on process exit.

```bash
npm exec --yes pnpm@11.4.0 -- install
DEPLOYMENT_PROFILE=memory npm exec --yes pnpm@11.4.0 -- build
DEPLOYMENT_PROFILE=memory npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

Verify the server is up:

```bash
curl http://localhost:3000/health
```

The health response reports `ok` with only the process-level
`memory-store` indicator. Postgres, Redis, and Qdrant indicators are not
present in this profile.

Optional: enable deterministic local embeddings for hybrid recall.

```bash
DEPLOYMENT_PROFILE=memory \
EMBEDDING_PROVIDER=local \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

### Memory profile recovery

There is nothing to recover — the process owns its data. Stop the process
and restart to wipe the in-memory state. There is no on-disk persistence
and no checkpoint.

## Lite Profile

The Lite profile persists memories to an AES-256-GCM encrypted file
store at `LOCAL_DATA_DIR` (default `~/.engram/data`). Postgres is the
source of truth for the server; Redis and Qdrant are absent. The file
store is independent of the server's profile-lite path and is where
`profile-lite` writes its primary data.

```bash
npm exec --yes pnpm@11.4.0 -- install
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

`LOCAL_ENCRYPTION_KEY` must be a 32-byte (256-bit) key. Base64-encode the
raw bytes; the secure-startup helper decodes it. Generate a fresh key
per host and never commit it.

Verify:

```bash
curl http://localhost:3000/health
ls -ld ~/.engram/data
stat -c '%a %n' ~/.engram/data/*.json
```

The directory must be `0700` and every file `0600`. The server refuses
to start if any file is group- or world-readable.

### Lite profile recovery

If the directory is missing, the server recreates it on startup with
the correct `0700` / `0600` modes. If a file has the wrong mode, the
server refuses to start. Fix the mode and restart:

```bash
chmod 0700 ~/.engram/data
find ~/.engram/data -type f -exec chmod 0600 {} +
DEPLOYMENT_PROFILE=lite \
LOCAL_ENCRYPTION_KEY="<your-key>" \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

If the key is lost, the encrypted records are unrecoverable. Wipe and
restart with a fresh key:

```bash
rm -rf ~/.engram/data
DEPLOYMENT_PROFILE=lite \
LOCAL_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

For production runs, the server refuses to start without
`LOCAL_ENCRYPTION_KEY`. In development it derives an ephemeral key with
a warning so you can iterate without provisioning credentials.

## Enterprise Profile

The Enterprise profile uses Postgres, Redis, and Qdrant. Hybrid
lexical + semantic retrieval is enabled out of the box, and the full
reindex / queue / cancel / retry maintenance tool set is exposed.

```bash
npm exec --yes pnpm@11.4.0 -- install
test -f .env || cp .env.example .env
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- docker:up
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- db:generate
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- db:migrate
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- build
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

Open a second terminal and verify the server:

```bash
curl http://localhost:3000/health
```

The health response should report `ok` when PostgreSQL, Redis, and
Qdrant are ready.

### Start Specific Workspaces

Run one workspace at a time during local development.

| Workspace  | Command                        | Default URL             |
| ---------- | ------------------------------ | ----------------------- |
| MCP server | `pnpm --filter mcp-server dev` | `http://localhost:3000` |
| Web app    | `pnpm --filter web dev`        | `http://localhost:3000` |
| Docs app   | `pnpm --filter docs dev`       | `http://localhost:3001` |

The MCP server and web app both use port `3000` by default, so do not
run those two commands at the same time unless you change `PORT` for
one of them.

### Local Infrastructure

Docker Compose starts the backing services used by the MCP server.

| Task                          | Command               |
| ----------------------------- | --------------------- |
| Start services and wait       | `pnpm docker:up`      |
| Show service status           | `pnpm docker:ps`      |
| Tail service logs             | `pnpm docker:logs`    |
| Restart services              | `pnpm docker:restart` |
| Stop services and keep data   | `pnpm docker:down`    |
| Stop services and delete data | `pnpm docker:clean`   |

Default host ports:

| Service     | Environment setting | Default |
| ----------- | ------------------- | ------- |
| PostgreSQL  | `POSTGRES_PORT`     | `5432`  |
| Redis       | `REDIS_PORT`        | `6379`  |
| Qdrant HTTP | `QDRANT_HTTP_PORT`  | `6333`  |
| Qdrant gRPC | `QDRANT_GRPC_PORT`  | `6334`  |

If Docker reports that a port is already allocated, edit `.env` before
starting services. Keep each service URL aligned with the host port. For
example, `POSTGRES_PORT=5433` also needs `DATABASE_URL` to use
`localhost:5433`.

### Database Commands

| Task                                   | Command                  |
| -------------------------------------- | ------------------------ |
| Generate Prisma client                 | `pnpm db:generate`       |
| Create and run a development migration | `pnpm db:migrate`        |
| Deploy migrations                      | `pnpm db:migrate:deploy` |
| Push schema without a migration        | `pnpm db:push`           |
| Reset the local database               | `pnpm db:reset`          |
| Open Prisma Studio                     | `pnpm db:studio`         |

Use `pnpm db:migrate` for schema changes that should be committed. Use
`pnpm db:push` only for short-lived local experiments.

### Enterprise profile recovery

The Enterprise profile uses replicated state. For a single-node local
stack, follow the same Docker flow with `docker:clean` followed by
`docker:up` and `db:migrate`:

```bash
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- docker:clean
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- docker:up
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- db:migrate
```

If the vector store drifted from Postgres (embeddings missing or
stale), reindex from the source of truth:

```bash
DEPLOYMENT_PROFILE=enterprise \
MCP_ADMIN_TOKEN="$MCP_ADMIN_TOKEN" \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server reindex
```

The CLI is cursor-resumable; pass `--cursor <id>` to continue from a
previous run.

## Profile-to-Profile Migration Runbook

This runbook covers promoting a `profile-lite` deployment to
`profile-enterprise`. The migration is dual-write, resumable, and
verifies zero data loss before cutover. SLO targets live in
[docs/RELEASE_GATES.md](RELEASE_GATES.md).

### Migration prerequisites

- `profile-lite` deployment running with a known `LOCAL_ENCRYPTION_KEY`
- Postgres reachable from the `profile-enterprise` host
- Redis and Qdrant reachable from the `profile-enterprise` host
- `MCP_ADMIN_TOKEN` set in both environments
- A `profile-enterprise` build with the migration tooling enabled
  (the server build from this repository)

### Step 1 — Stop profile-lite writes

Stop the `profile-lite` server cleanly so no in-flight writes remain
unflushed. The on-disk `LiteJsonStore` writes atomically on every
mutation, so a graceful shutdown leaves a consistent snapshot.

```bash
# On the profile-lite host
systemctl stop engram
ls -la ~/.engram/data
# Confirm every file is mode 0600
```

### Step 2 — Bring up profile-enterprise infrastructure

On the new host, start Postgres, Redis, and Qdrant, then run the
migrations.

```bash
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- docker:up
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- db:generate
DEPLOYMENT_PROFILE=enterprise npm exec --yes pnpm@11.4.0 -- db:migrate
```

The migration state machine starts at `idle`. No client traffic flows
to `profile-enterprise` yet.

### Step 3 — Export and dual-write

Boot the `profile-enterprise` server with the migration tooling
enabled. The dual-write coordinator begins streaming the `profile-lite`
source into the `profile-enterprise` shadow store while the backfill
service streams the historical snapshot.

```bash
DEPLOYMENT_PROFILE=enterprise \
LOCAL_ENCRYPTION_KEY="<source-key>" \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

The state machine advances `idle → preparing → copying → verifying`.
The `copying` phase streams in pages; the cursor is persisted on every
page so an interrupted pass resumes from the last `(userId, memoryId)`
pair with no duplicates.

### Step 4 — Verify (count + hash comparison)

Run the verifier to confirm the `profile-lite` source matches the
`profile-enterprise` shadow before allowing cutover.

```bash
DEPLOYMENT_PROFILE=enterprise \
LOCAL_ENCRYPTION_KEY="<source-key>" \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server verify-migration
```

The verifier emits a JSON report and refuses to advance when the
hard-stop fraction (`0.00001` default) is exceeded. Investigate any
per-user count or content-hash mismatch before continuing. A passing
report auto-advances the state to `cutting_over`.

### Step 5 — Cutover

Once verification passes, complete the migration:

```bash
DEPLOYMENT_PROFILE=enterprise \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server cutover-migration
```

Re-point the client configuration to the `profile-enterprise` endpoint
and restart the client. The `profile-lite` host remains in read-only
shadow mode during the rollback window.

### Step 6 — Rollback

If `profile-enterprise` is unhealthy after cutover, abort the
migration:

```bash
DEPLOYMENT_PROFILE=enterprise \
  npm exec --yes pnpm@11.4.0 -- --filter mcp-server abort-migration
```

Re-point the client back to `profile-lite` and start it. The on-disk
state was never modified by the migration tooling, so the source
remains readable.

## MCP Client Setup

To run one persistent server that all agents share over HTTP instead of each client spawning its own stdio process, see [agent-memory-server.md](agent-memory-server.md).

Build the server first:

```bash
npm exec --yes pnpm@11.4.0 -- build
```

Copy the example client config:

```bash
cp claude_desktop_config.json.example claude_desktop_config.json
```

Edit `claude_desktop_config.json` so the `args` value points to the
absolute path for `apps/mcp-server/dist/main.js` in your checkout.
Prepend `DEPLOYMENT_PROFILE=...` to the `args` list when the client
runs the server itself, or set the variable in the launching shell.

Common Claude Desktop config locations:

| Operating system | Config path                                                       |
| ---------------- | ----------------------------------------------------------------- |
| Linux            | `~/.config/Claude/claude_desktop_config.json`                     |
| macOS            | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows          | `%APPDATA%\\Claude\\claude_desktop_config.json`                   |

After copying the config into place, restart the MCP client and ask it
to call the `ping` tool.

## Troubleshooting

Check Docker service health:

```bash
npm exec --yes pnpm@11.4.0 -- docker:ps
npm exec --yes pnpm@11.4.0 -- docker:logs
```

Regenerate Prisma after schema or dependency changes:

```bash
npm exec --yes pnpm@11.4.0 -- db:generate
```

Reset local infrastructure data when a development database is no
longer useful:

```bash
npm exec --yes pnpm@11.4.0 -- docker:clean
npm exec --yes pnpm@11.4.0 -- docker:up
npm exec --yes pnpm@11.4.0 -- db:migrate
```

Check direct service health:

```bash
curl http://localhost:3000/health
curl http://localhost:6333/health
```

If `profile-lite` refuses to start with a permission error, fix the
data-dir modes and restart:

```bash
chmod 0700 ~/.engram/data
find ~/.engram/data -type f -exec chmod 0600 {} +
```

If `profile-memory` exits immediately, confirm the env var is set
before the install / build / dev commands. The `DEPLOYMENT_PROFILE`
flag is read at module-load time, so changing it after the process
boots has no effect.
