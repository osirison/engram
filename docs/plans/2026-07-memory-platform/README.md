# Memory Platform Work-Package Suite (2026-07-05)

Master index for six work packages requested by qp. Each WP is **self-contained** and
**executable by a lower model** (Opus 4.8 / Sonnet 5) without reading this session's
transcript. Read `CLAUDE.md` and `AGENTS.md` at repo root before executing any WP.

## Resume protocol (if a session died mid-work)

1. This suite lives in worktree `.claude/worktrees/plans-suite-2026-07`
   (branch `worktree-plans-suite-2026-07`). Re-enter it; do not recreate it.
2. Check the **Status** table below, then `git log --oneline` and `git status` in the
   worktree — uncommitted WP files on disk are valid completed work; commit them.
3. Any WP marked `pending` below with no file on disk must be (re)generated per the
   "WP specs" section. WPs are independent — regenerate only what is missing.

## Status

| WP  | Deliverable                                       | State   |
| --- | ------------------------------------------------- | ------- |
| WP1 | `WP1-marketing-site-validation/REPORT.md`         | pending |
| WP2 | `WP2-memory-ui/PLAN.md`                           | pending |
| WP3 | `WP3-markdown-export/PLAN.md`                     | pending |
| WP4 | `WP4-agent-memory-import/PLAN.md`                 | pending |
| WP5 | `WP5-primary-memory-integration/PLAN.md`          | pending |
| WP6 | `WP6-developer-docs/PLAN.md`                      | pending |
| —   | `GAPS.md` (cross-cutting gaps qp may have missed) | pending |

## Dependency graph (for executors)

- WP1 is standalone (validation report + remediation tasks). Execute any time.
- WP2, WP3, WP4 are independent of each other; all touch `packages/memory-ltm` /
  `apps/web` — coordinate only on shared Prisma schema changes (see each PLAN's
  "Schema changes" section; apply schema migrations serially, everything else in parallel).
- WP5 depends on WP4's importer/provenance model existing (concepts, not code) — its
  plan can be executed in parallel, but ship WP4 importers first.
- WP6 is standalone; it documents whatever exists at execution time.

## Conventions every executor must follow

- One git worktree per WP when executing (`EnterWorktree` / `git worktree add`),
  rebased onto `origin/main` first. Never regenerate `pnpm-lock.yaml`.
- Conventional commits `type(scope): summary (#issue)`, body ≤ 300 chars, never `--no-verify`.
- Every feature needs tests at **both** the service level and the wiring/parent-service level.
- All MCP tool inputs use Zod `.strict()` schemas; register tools in
  `packages/core/src/mcp/tools/index.ts`.
- Postgres is the source of truth; vector store is a derived index.
- All Engram MCP tool calls in examples/tests for qp use `userId: "qp"`.

## WP specs (inputs used to generate each deliverable)

- **WP1 — Marketing-site validation** (`apps/marketing-site`, Vite+React 18, standalone
  `package-lock.json`): validate every factual claim against the codebase, verify the
  installation instructions shown on the site against `README.md`/root `package.json`,
  and audit performance (bundle size, assets, render-blocking scripts). Output is a
  findings report with severity-rated, parallelizable remediation tasks.
- **WP2 — Memory management UI**: view/edit/delete memories from the UI. Home:
  `apps/web` (Next.js, tRPC, Prisma, auth.ts). Must handle STM (Redis) vs LTM
  (Postgres), re-embedding on edit, vector-store cleanup on delete.
- **WP3 — Rich markdown export**: export memories to markdown preserving
  inter-memory relationships (links/graph). Obsidian-compatible wikilinks + frontmatter.
- **WP4 — Agentic memory import**: importers for Claude Code, Copilot, Cursor, Codex,
  Gemini (+generic), preserving links between memories; provenance + dedup.
- **WP5 — Engram as primary agent memory**: per-agent MCP wiring + hooks so agents
  automatically store to and recall from Engram as their primary memory.
- **WP6 — Developer docs app**: full developer documentation (every feature/function)
  using standard OSS docs tooling; evaluate against `apps/docs` (Next.js starter) and
  the existing Pages deploy in CI.
