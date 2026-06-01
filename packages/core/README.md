---
title: ENGRAM Core Package
description: MCP registry, logging, and shared core utilities for ENGRAM
---

## Overview

`@engram/core` contains shared MCP and logging code used by the MCP server. It
exports the MCP module, handler, tool registry, and core types.

## Exports

| Export          | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `McpModule`     | NestJS module for MCP support                   |
| `McpHandler`    | MCP protocol handler used by the server runtime |
| `registerTools` | Tool registration helper                        |
| `Tool`          | Type for MCP tool definitions                   |
| `pingTool`      | Connectivity test tool                          |
| `LoggingModule` | Shared logging module                           |

## Commands

| Task       | Command                                |
| ---------- | -------------------------------------- |
| Build      | `pnpm --filter @engram/core build`     |
| Run lint   | `pnpm --filter @engram/core lint`      |
| Type-check | `pnpm --filter @engram/core typecheck` |
| Run tests  | `pnpm --filter @engram/core test`      |

## Related Docs

- MCP tool development: [src/mcp/tools/README.md](src/mcp/tools/README.md)
- MCP server: [../../apps/mcp-server/README.md](../../apps/mcp-server/README.md)
