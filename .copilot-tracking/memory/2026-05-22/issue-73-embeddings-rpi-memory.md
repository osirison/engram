<!-- markdownlint-disable-file -->

# Memory: issue-73-embeddings-rpi

**Created:** 2026-05-22 17:41 BST | **Last Updated:** 2026-05-22 17:41 BST

## Task Overview

Continue Issue #73 RPI workflow on branch feat/issue-73-embeddings, execute suggested follow-up items, validate changes, and keep PR #95 ready. Most recent checkpoint operation requested via checkpoint prompt (default save mode).

## Current State

- Completed prior continue=all wave:
  - Added embeddings Prometheus exporter via getPrometheusMetrics in packages/embeddings/src/embeddings.service.ts.
  - Added backfill retry/backoff controls and retry wrapper in packages/embeddings/src/scripts/backfill-ltm-embeddings.ts.
  - Added vector guardrails and tests in packages/vector-store/src/qdrant.service.ts and packages/vector-store/src/qdrant.service.spec.ts.
  - Updated docs in packages/embeddings/README.md.
- Completed continue=1 item (metrics endpoint wiring):
  - Added GET /health/metrics in apps/mcp-server/src/health/health.controller.ts.
  - Wired EmbeddingsModule into apps/mcp-server/src/health/health.module.ts.
  - Added new unit test file apps/mcp-server/src/health/health.controller.spec.ts.
  - Updated apps/mcp-server/README.md endpoint docs.
  - Updated apps/mcp-server/package.json dependency + jest moduleNameMapper for @engram/embeddings.
- Validation completed and green for touched areas:
  - npx pnpm --filter @engram/embeddings test
  - npx pnpm --filter @engram/embeddings typecheck
  - npx pnpm --filter @engram/vector-store test
  - npx pnpm --filter @engram/vector-store typecheck
  - npx pnpm --filter mcp-server test -- health
- Working tree currently has uncommitted changes in embeddings/vector-store/mcp-server files and one new untracked test file.

## Important Discoveries

- **Decisions:**
  - Exposed embeddings metrics through /health/metrics in mcp-server health controller rather than a separate metrics module to keep endpoint discoverable and low-friction.
  - Added optional EmbeddingsService injection to avoid hard failure when embeddings wiring is absent.
  - Added Jest moduleNameMapper for @engram/embeddings in apps/mcp-server/package.json to support controller unit tests.
- **Failed Approaches:**
  - Running pnpm directly in shell failed due PATH issue; switched to npx pnpm.
  - Initial health controller test run failed with "Cannot find module @engram/embeddings" until jest mapper was added.
  - Full mcp-server build in this environment reported existing multi-package TS resolution errors not introduced by this endpoint patch.

## Next Steps

1. Commit staged/uncommitted changes for continue=all + continue=1 updates with Issue #73 conventional message.
2. Push branch feat/issue-73-embeddings and verify PR #95 diff/description reflects metrics endpoint + prior hardening.
3. Continue next suggested item if requested:
   - Add retry jitter + max delay caps for backfill.
   - Add createCollection input guardrails in Qdrant service.
   - Add HTTP-level integration test for /health/metrics.

## Context to Preserve

- **Sources:**
  - run_in_terminal: rg -n "metrics|counter|backfill|retry|vector|guard|similarity|distance" packages/... - located all integration points.
  - run_in_terminal: npx pnpm --filter @engram/embeddings test/typecheck - embeddings suite passed after deterministic metrics test adjustment.
  - run_in_terminal: npx pnpm --filter @engram/vector-store test/typecheck - vector-store suite passed with new guardrail tests.
  - run_in_terminal: npx pnpm --filter mcp-server test -- health - health suites all green including new health.controller.spec.ts.
- **Agents:** none.
- **Questions:**
  - Decide whether to resolve broader mcp-server workspace build path issues now or defer to separate task, since health-focused tests are currently green.
