---
description: Research notes for Docker-hosted MCP Inspector support in ENGRAM
---

<!-- markdownlint-disable-file -->

## Scope

Add an isolated, Docker-hosted way to use the MCP Inspector against ENGRAM without requiring a local inspector install.

## Findings

- The official MCP Inspector ships a Docker image at `ghcr.io/modelcontextprotocol/inspector:latest`.
- The Inspector supports `stdio`, `sse`, and `streamable-http` transports.
- ENGRAM currently uses stdio for MCP transport only.
- The SDK already exposes `StreamableHTTPServerTransport`, including a stateless mode that fits ENGRAM’s current server shape.

## Selected approach

Expose ENGRAM’s MCP endpoint over Streamable HTTP at `/mcp`, keep stdio as the default client path, and add a Docker Compose profile for the Inspector that runs the official Inspector image and points at the HTTP MCP endpoint.

## Rationale

- Avoids local inspector installs.
- Avoids mounting the repo into the Inspector container just to spawn a local command.
- Keeps the existing stdio client setup intact.
- Makes the Inspector usable against a Dockerized or host-run ENGRAM server through a stable URL.
