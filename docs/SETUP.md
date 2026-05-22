---
title: ENGRAM Setup
description: Local development and MCP client setup for ENGRAM
---

## Prerequisites

Install these tools before starting:

- Node.js 20 or newer
- pnpm 8 or newer
- Docker and Docker Compose
- Git

## First Run

Run all commands from the repository root.

```bash
pnpm install
cp .env.example .env
pnpm docker:up
pnpm db:generate
pnpm db:migrate
pnpm --filter mcp-server dev
```

Open a second terminal and verify the server:

```bash
curl http://localhost:3000/health
```

The health response should report `ok` when PostgreSQL, Redis, and Qdrant are
ready.

## Start Specific Workspaces

Run one workspace at a time during local development.

| Workspace  | Command                        | Default URL             |
| ---------- | ------------------------------ | ----------------------- |
| MCP server | `pnpm --filter mcp-server dev` | `http://localhost:3000` |
| Web app    | `pnpm --filter web dev`        | `http://localhost:3000` |
| Docs app   | `pnpm --filter docs dev`       | `http://localhost:3001` |

The MCP server and web app both use port `3000` by default, so do not run those
two commands at the same time unless you change `PORT` for one of them.

## Local Infrastructure

Docker Compose starts the backing services used by the MCP server.

| Task                          | Command               |
| ----------------------------- | --------------------- |
| Start services                | `pnpm docker:up`      |
| Show service status           | `pnpm docker:ps`      |
| Tail service logs             | `pnpm docker:logs`    |
| Restart services              | `pnpm docker:restart` |
| Stop services and keep data   | `pnpm docker:down`    |
| Stop services and delete data | `pnpm docker:clean`   |

Service ports:

| Service     | Port   |
| ----------- | ------ |
| PostgreSQL  | `5432` |
| Redis       | `6379` |
| Qdrant HTTP | `6333` |
| Qdrant gRPC | `6334` |

## Database Commands

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

## MCP Client Setup

Build the server first:

```bash
pnpm build
```

Copy the example client config:

```bash
cp claude_desktop_config.json.example claude_desktop_config.json
```

Edit `claude_desktop_config.json` so the `args` value points to the absolute
path for `apps/mcp-server/dist/main.js` in your checkout.

Common Claude Desktop config locations:

| Operating system | Config path                                                       |
| ---------------- | ----------------------------------------------------------------- |
| Linux            | `~/.config/Claude/claude_desktop_config.json`                     |
| macOS            | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows          | `%APPDATA%\\Claude\\claude_desktop_config.json`                   |

After copying the config into place, restart the MCP client and ask it to call
the `ping` tool.

## Troubleshooting

Check Docker service health:

```bash
pnpm docker:ps
pnpm docker:logs
```

Regenerate Prisma after schema or dependency changes:

```bash
pnpm db:generate
```

Reset local infrastructure data when a development database is no longer useful:

```bash
pnpm docker:clean
pnpm docker:up
pnpm db:migrate
```

Check direct service health:

```bash
curl http://localhost:3000/health
curl http://localhost:6333/health
```
