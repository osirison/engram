---
description: Change log for Docker-hosted MCP Inspector support in ENGRAM
---

<!-- markdownlint-disable-file -->

## Related Plan

- [mcp-inspector-docker-plan.instructions.md](../../../.copilot-tracking/plans/2026-06-02/mcp-inspector-docker-plan.instructions.md)

## Implementation Date

- 2026-06-02

## Summary

Added an optional Streamable HTTP MCP path, a Docker Compose Inspector profile, and setup documentation for running the Inspector in an isolated containerized workflow.

## Changes by Category

### Added

- [apps/mcp-server/src/types/modelcontextprotocol-streamable-http.d.ts](../../../apps/mcp-server/src/types/modelcontextprotocol-streamable-http.d.ts)
- [mcp-inspector-docker-research.md](../../../.copilot-tracking/research/2026-06-02/mcp-inspector-docker-research.md)
- [mcp-inspector-docker-plan.instructions.md](../../../.copilot-tracking/plans/2026-06-02/mcp-inspector-docker-plan.instructions.md)
- [mcp-inspector-docker-details.md](../../../.copilot-tracking/details/2026-06-02/mcp-inspector-docker-details.md)
- [mcp-inspector-docker-changes.md](../../../.copilot-tracking/changes/2026-06-02/mcp-inspector-docker-changes.md)
- [mcp-inspector-docker-plan-review.md](../../../.copilot-tracking/reviews/2026-06-02/mcp-inspector-docker-plan-review.md)

### Modified

- [README.md](../../../README.md)
- [docs/SETUP.md](../../../docs/SETUP.md)
- [apps/mcp-server/README.md](../../../apps/mcp-server/README.md)
- [apps/mcp-server/src/main.ts](../../../apps/mcp-server/src/main.ts)
- [docker-compose.yml](../../../docker-compose.yml)
- [.env.example](../../../.env.example)
- [packages/config/src/env.schema.ts](../../../packages/config/src/env.schema.ts)
- [packages/config/src/env.schema.spec.ts](../../../packages/config/src/env.schema.spec.ts)
- [packages/core/src/mcp/mcp.handler.ts](../../../packages/core/src/mcp/mcp.handler.ts)

## Notes

The repository-wide docs checker still reports unrelated preexisting frontmatter issues in legacy `.github` and `.specify` markdown files. The touched files themselves passed targeted diff integrity checks and the TypeScript validation/build path.
