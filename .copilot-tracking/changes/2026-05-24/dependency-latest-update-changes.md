<!-- markdownlint-disable-file -->

# Dependency Latest Update Changes

## Related Plan

[Dependency Latest Update Plan](../../../plans/2026-05-24/dependency-latest-update-plan.instructions.md)

## Implementation Date

2026-05-24

## Summary

Refreshed workspace dependencies to the latest published versions and regenerated the lockfile. The update also required a small core test compatibility fix because the upgraded MCP SDK now exposes Zod schema internals through `def.shape` instead of the older `shape._def` path.

## Changes By Category

### Modified

- [package.json](../../../package.json)
- [apps/docs/package.json](../../../apps/docs/package.json)
- [apps/mcp-server/package.json](../../../apps/mcp-server/package.json)
- [apps/web/package.json](../../../apps/web/package.json)
- [packages/config/package.json](../../../packages/config/package.json)
- [packages/core/package.json](../../../packages/core/package.json)
- [packages/core/src/mcp/tools/index.spec.ts](../../../packages/core/src/mcp/tools/index.spec.ts)
- [packages/database/package.json](../../../packages/database/package.json)
- [packages/embeddings/package.json](../../../packages/embeddings/package.json)
- [packages/eslint-config/package.json](../../../packages/eslint-config/package.json)
- [packages/memory-ltm/package.json](../../../packages/memory-ltm/package.json)
- [packages/memory-stm/package.json](../../../packages/memory-stm/package.json)
- [packages/redis/package.json](../../../packages/redis/package.json)
- [packages/typescript-config/package.json](../../../packages/typescript-config/package.json)
- [packages/ui/package.json](../../../packages/ui/package.json)
- [packages/vector-store/package.json](../../../packages/vector-store/package.json)
- [pnpm-lock.yaml](../../../pnpm-lock.yaml)

## Additional Notes

- The workspace already had unrelated branch changes before this update. Those were left untouched.
- `pnpm install` completed successfully after the refresh.
- `apps/web` and `apps/docs` both built successfully after the dependency update.
- `packages/core` tests passed after updating the MCP request-schema inspection helper.
