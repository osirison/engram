---
description: Detailed execution notes for Docker-hosted MCP Inspector support in ENGRAM
---

<!-- markdownlint-disable-file -->

## References

- Plan: [mcp-inspector-docker-plan.instructions.md](../../../.copilot-tracking/plans/2026-06-02/mcp-inspector-docker-plan.instructions.md)
- Research: [mcp-inspector-docker-research.md](../../../.copilot-tracking/research/2026-06-02/mcp-inspector-docker-research.md)

## Execution Notes

### Phase 1

- Wire Streamable HTTP support into the MCP server bootstrap.
- Keep the current stdio startup path intact for the existing Claude Desktop workflow.

### Phase 2

- Add an Inspector service under a dedicated Compose profile.
- Keep the Inspector ports bound to localhost.
- Document the Docker run / compose flow and the Inspector URL.

### Phase 3

- Refresh setup docs and root README language to make the new testing path obvious.
- Add the new environment variable to `.env.example`.
