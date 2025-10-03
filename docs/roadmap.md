# ENGRAM Roadmap (Living Document)

This roadmap captures the near-term execution plan so contributors can align quickly and resume work at any time. It complements issue discussions and is updated alongside milestone changes.

## Current Focus: Core Infrastructure (Epic #6)

Goal: Establish a reliable NestJS MCP server, database foundation, health endpoints, and developer tooling to unblock higher-level features.

References: Epic #6, Issues #23, #24, #25, #20, #19, #5. Future epics: #7–#12.

## Parallel Tracks (Start Now)

- Track A — MCP Protocol Foundation
  - #23: Install @modelcontextprotocol/sdk; create MCP handler/module; wire into `apps/mcp-server` and `packages/core`.
- Track B — Database Foundation
  - #20: Install & configure Prisma; add `packages/database` module; initial schema, scripts, and migrations.
- Track C — Developer Experience
  - #5: Husky + lint-staged + commitlint; VS Code format-on-save.
- Track D — Health Scaffolding
  - #19: Create health module/controller and `/health` route; add service checks incrementally.

## Sequencing and Dependencies

- After #23 completes → #24: Implement basic MCP tools (`ping`, `list_tools`) with Zod validation and logging.
- After #23 and #24 complete → #25: Test MCP from Claude Desktop; add docs/SETUP.md and example config; verify tool calls.
- Finalize #19 after #20 by adding DB health indicator; extend to Redis/Qdrant using existing modules.

## Waves

- Wave 1 (parallel): #23, #20, #5, basic #19
- Wave 2: #24 (depends on #23)
- Wave 3: #25 (depends on #23 + #24) and finalize #19 (after #20)

## Suggested Ownership

- Infra/MCP: #23 → #24 → #25
- Backend/DB: #20 → #19 enhancements
- DevEx/Tooling: #5

## Risks and Mitigations

- MCP SDK/transport nuances: Start minimal; log verbosely; test locally.
- Prisma/docker connectivity: Validate DATABASE_URL early; add a smoke query test.
- Health checks timing: Ship endpoint early; expand checks incrementally.
- Claude Desktop config variance: Provide Windows/macOS paths and troubleshooting.

## Branching & PR Hygiene

- Branch names: `feat/mcp-handler-#23`, `feat/prisma-setup-#20`, `feat/dev-hooks-#5`, `feat/health-endpoint-#19`, `feat/mcp-tools-#24`, `feat/claude-setup-#25`
- Single-line commits referencing issue #. Wait for green checks before requesting review.

## Track-Based Worktrees (Summary)

We use persistent Git worktrees per focus area to enable parallel work with minimal churn. Tracks: `mcp`, `db`, `devex`, `health`.

- One-time setup: create worktrees from `origin/main` with parking branches `track/{track}`
- Per issue: from the track directory, branch off `origin/main` → implement → single-line commit with `(#issue)` → PR to `main`
- Cleanup: delete the feature branch after merge; keep worktrees for reuse

See full instructions with copyable PowerShell commands in `AGENTS.md` → Track-Based Worktrees: AGENTS.md#track-based-worktrees-persistent-tracks

## Reflecting Tracks in GitHub

To make tracks visible and actionable on GitHub:

1. Push parking branches so tracks are discoverable

```powershell
git push -u origin track/mcp
git push -u origin track/db
git push -u origin track/devex
git push -u origin track/health
```

2. Labels: create `track:mcp`, `track:db`, `track:devex`, `track:health`

- Apply to issues/PRs to indicate ownership; add saved views per label

3. Branch/PR discipline

- One issue → one PR to `main`
- Branch name: `type/kebab-name-#<issue>` (e.g., `feat/mcp-sdk-handler-#23`)
- Commit format: `type(scope): description (#123)`

4. Optional: Project board per track

- Columns: MCP, DB, DevEx, Health; filter cards by `track:*` labels
- Saved views: per-track, “Wave 1/2/3” filters using labels/milestones

## Next Actions

- Kick off Wave 1 branches and post progress updates per issue.

> Last updated: 2025-10-02. Keep this concise and aligned with issue comments (see Epic #6).
