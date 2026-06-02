---
description: Implementation plan for Docker-hosted MCP Inspector support in ENGRAM
---

<!-- markdownlint-disable-file -->

## User Requests

- Find what needs to be added for the MCP Inspector, including documentation, so ENGRAM can be tested with it.
- Update the setup instructions.
- Use a streamlined approach isolated from the local environment.
- Figure out how Docker can host the Inspector.

## Overview

Add an optional Streamable HTTP MCP path to ENGRAM and document a Docker Compose profile that runs the official MCP Inspector container against that endpoint.

## Context Summary

Relevant instructions and repository guidance:

- [AGENTS.md](../../../AGENTS.md)
- [CLAUDE.md](../../../CLAUDE.md)
- [README.md](../../../README.md)
- [docs/SETUP.md](../../../docs/SETUP.md)
- [apps/mcp-server/README.md](../../../apps/mcp-server/README.md)
- [docker-compose.yml](../../../docker-compose.yml)

## Implementation Checklist

### Phase 1: Server transport support

<!-- parallelizable: false -->

- [x] Add a validated env flag for selecting MCP transport.
- [x] Extend the MCP handler to connect either stdio or Streamable HTTP.
- [x] Expose `/mcp` only when Streamable HTTP is enabled.
- [x] Keep stdio as the default path so existing local client setup still works.

### Phase 2: Docker inspector profile

<!-- parallelizable: false -->

- [x] Add a Compose profile that runs `ghcr.io/modelcontextprotocol/inspector:latest`.
- [x] Bind the Inspector to localhost-only ports.
- [x] Add `host.docker.internal` access for Linux so the container can reach the host server when needed.
- [x] Document the exact launch and browser URL for the Inspector.

### Phase 3: Documentation refresh

<!-- parallelizable: true -->

- [x] Update the root README with the Inspector workflow.
- [x] Update `docs/SETUP.md` with the Docker-based Inspector steps.
- [x] Update the MCP server README with the new transport mode and inspector testing notes.
- [x] Update `.env.example` with the new transport setting.

## Validation Plan

- Run targeted TypeScript build/type-check for the touched workspace(s).
- Run the repository’s documentation check script used by this workspace.

## Success Criteria

- The MCP Inspector can run from Docker without a local install.
- ENGRAM exposes a remote MCP endpoint suitable for Inspector testing.
- Setup docs explain the exact commands and URL needed to use the Inspector container.
- Existing stdio-based MCP client setup remains available.
