---
title: ENGRAM
description: Durable, searchable long-term memory for AI agents, over the Model Context Protocol (MCP).
---

# ENGRAM

**Give your AI agents a memory that outlives a single chat — over the [Model Context Protocol](https://modelcontextprotocol.io).**

ENGRAM is a memory server for Claude and any other MCP-compatible assistant. It
remembers facts, decisions, and context across sessions and hands the right ones
back on demand — so your agents stop re-learning what they already knew.

- 🧠 **Remembers across sessions** — short-term and long-term memory, with automatic promotion and expiry.
- 🔎 **Semantic recall** — hybrid keyword + vector search surfaces the memory that matters, not just exact matches.
- 🔌 **Works with your tools** — Claude Desktop, Claude Code, and any MCP client get a `remember` / `recall` tool set that just works.
- 📦 **One dependency** — PostgreSQL (with pgvector). No Redis, no separate vector database.
- 🔒 **Private by default** — runs on your machine; embeddings come from a local Ollama model, no API keys required.

## Quick start

You need [Node.js 22.13.0+](https://nodejs.org) and [Docker](https://docs.docker.com/get-docker/) (for the bundled PostgreSQL).

```bash
git clone https://github.com/osirison/engram.git
cd engram
./scripts/install.sh --start
```

That's it. The installer sets everything up and starts a memory server on
**http://localhost:3000**. Prefer to launch it yourself? Drop `--start` and run
the command it prints when it's done.

Check that it's alive:

```bash
curl http://localhost:3000/health
```

> Want the multi-tenant setup (auth, API keys, per-agent access)? Run
> `./scripts/install.sh --standard` instead. Both profiles run on Postgres
> alone — see the [developer guide](docs/SETUP.md).

## Connect your AI assistant

Point Claude Desktop or Claude Code at the running server, then ask it to call
the `ping` tool to confirm the connection. The short walkthrough — including the
ready-made config file — is in
[the MCP client setup guide](docs/SETUP.md#mcp-client-setup).

## What can it do?

Once connected, your assistant gains a memory tool set: `remember` and `recall`
for everyday use, plus full memory CRUD, hybrid semantic + keyword search,
short-term ↔ long-term promotion, and admin maintenance tools. Poke at every
tool live with the [MCP Inspector](docs/SETUP.md#mcp-inspector).

## Learn more

| I want to…                                        | Go to                                                          |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Install, run, and configure ENGRAM in depth       | [Developer guide](docs/SETUP.md)                               |
| Browse the full documentation                     | [engram.events/docs](https://engram.events/docs/)              |
| Get started on the docs site                      | [Getting started](https://engram.events/docs/getting-started/) |
| Use ENGRAM as shared memory for a fleet of agents | [Agent memory contract](docs/agent-memory-contract.md)         |
| Contribute to ENGRAM                              | [AGENTS.md](AGENTS.md)                                         |

Licensed under the terms in [LICENSE](LICENSE).
