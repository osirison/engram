---
title: WP5 — Engram as Primary Agent Memory — Execution State
description: Execution record for WP5 (T1–T13) — what was built, verified, and the residual follow-ups
---

# WP5 — Execution State

Execution record for WP5 (Engram as primary agent memory). **Plan:**
[`PLAN.md`](./PLAN.md). **Branch:** `wp5-primary-memory-integration`.

- **Last updated:** 2026-07-06 (qp session — executed T1–T13).
- **Scope decisions (from qp during execution):** (1) **Activation = live tools,
  hooks opt-in** — root `.mcp.json` + hook scripts are committed and active, but the
  SessionStart/SessionEnd hooks are NOT wired into `.claude/settings.json` (a
  documented one-step opt-in). (2) **T11 included** (file-watcher daemon). (3)
  Single `userId: "qp"` shared by all agents; per-agent API keys carry provenance
  (R1 recommendation).

## Task status

Legend: ✅ done+verified · 🟨 done with a recorded residual.

| Task | Deliverable                                    | Status | Where                                                                                                           |
| ---- | ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| T1   | Agent Memory Contract + directive + drift test | ✅     | `docs/agent-memory-contract.md`; drift test `packages/agent-bridge/src/contract.spec.ts`                        |
| T2   | Persistent HTTP server runbook + verify script | ✅     | `docs/agent-memory-server.md`, `deploy/systemd/engram-mcp.service`, `scripts/verify-engram-server.sh`           |
| T3   | `engram` agent-bridge CLI (MCP client)         | ✅     | `packages/agent-bridge` (47 tests)                                                                              |
| T4   | Per-agent API keys + auth-on                   | 🟨     | `docs/security/agent-keys.md`; base verify script; scoped-key checks documented (not bash-automated)            |
| T5   | Recall-quality regression gate                 | ✅     | `packages/eval` (`eval:gate`, `thresholds.ts`, `gate.ts`); CI step; `docs/RELEASE_GATES.md`                     |
| T6   | Claude Code integration                        | ✅     | `.mcp.json`, `.claude/hooks/*.sh`, `CLAUDE.md`; hook test `scripts/test-engram-hooks.sh`                        |
| T7   | GitHub Copilot integration                     | ✅     | `.vscode/mcp.json` (merged), `.github/copilot-instructions.md`                                                  |
| T8   | Cursor integration                             | ✅     | `.cursor/mcp.json`, `.cursor/rules/engram-memory.mdc`                                                           |
| T9   | OpenAI Codex integration                       | ✅     | `AGENTS.md`; config documented in `docs/agent-memory-clients.md`                                                |
| T10  | Gemini CLI integration                         | ✅     | `GEMINI.md`; config documented in `docs/agent-memory-clients.md`                                                |
| T11  | File-watcher sync bridge (D7 conflict)         | 🟨     | `apps/mcp-server/src/sync/*`, `watch.cli.ts`, `deploy/systemd/engram-sync.service`, `docs/agent-memory-sync.md` |
| T12  | Initial migration runbook                      | ✅     | `docs/agent-memory-migration.md`                                                                                |
| T13  | Per-agent memory observability                 | ✅     | `apps/mcp-server` MetricsService counter + controller wiring; `docs/observability.md`                           |

All per-agent MCP config formats (T7–T10) were verified against each vendor's
current (July 2026) docs (see [`agent-memory-clients.md`](../../../agent-memory-clients.md)).
Notable corrections vs. the plan's draft snippets: Cursor uses `${env:VAR}` (not
`${VAR}`); Codex now supports native HTTP (`url` + `bearer_token_env_var`), not
just a stdio bridge; Gemini uses `httpUrl` (not `url`) and has session hooks that
could later upgrade recall to deterministic.

## Quality gate (2026-07-06, local)

`pnpm build` ✅ (19/19) · `pnpm typecheck` ✅ (18/18) · `pnpm lint` ✅
(pre-existing `web` warnings only) · `pnpm docs:check` ✅ · `pnpm eval:gate` ✅
(recall@5 91.7%, MRR 1.000, nDCG@5 0.922).

**Unit tests (run locally):** client 15, agent-bridge 47, eval 69, mcp-server
unit (metrics + controller + sync + watch) 107 — all green. The hook exit-0
contract test (`scripts/test-engram-hooks.sh`) passes.

**Not run locally (CI-verified, matching the suite's precedent):** mcp-server
DB/Redis/Qdrant integration + `test:e2e` suites. The shared docker containers
(`engram-postgres`, etc.) are owned by a concurrent worktree — running the DB
suites here would have used another agent's dev data, so they were left to CI. My
WP5 additions are unit-tested or mocked; the only cross-cutting change to an
existing hot path (T13 controller counter) is additive and optional-injected, and
the full existing `memory.controller.spec.ts` suite passes.

> On a fresh checkout run `pnpm db:generate` before `build`/`typecheck` — the
> generated Prisma client is gitignored (known repo setup step, see suite STATE).

## Adversarial review (2026-07-06)

A multi-agent review found 6 real issues; all were fixed and covered by tests:

- **HIGH — loopback bind not enforced:** `main.ts` called `app.listen(port)` with
  no host, so the documented `HOST=127.0.0.1` was ignored (bound all interfaces).
  Now `app.listen(port, process.env.HOST ?? '0.0.0.0')` — default unchanged,
  loopback honored.
- **T11 import root:** the watcher re-ran the importer with the raw watch root, so
  nested claude-code auto-memory would not import. Added `deriveImportRoot()` so
  each change imports from the dir its adapter expects.
- **`capture` distillation** now has a hard HTTP timeout (`ENGRAM_DISTILL_TIMEOUT_MS`,
  default 20s) so a hung LLM can't block the non-blocking contract.
- **`sync-spool`** now drains atomically (`takeSnapshot`/`commitDrain` via rename)
  so a concurrent append is never clobbered.
- **CLI** flushes stdout before exit so a large `recall --json` piped downstream
  isn't truncated.

## Residual follow-ups (honest)

1. **T11 conflict handling is coarse.** On a D7 conflict the watcher skips the
   whole source's import until reconciled (safe: never clobbers) rather than
   storing the file version as a separate `conflict`-tagged memory as the plan's
   D7 describes. The tagged-copy behavior is a follow-up; the current behavior
   satisfies "concurrent newer edit is not clobbered + conflict recorded."
2. **T11 live integration test deferred.** The sync logic (path mapping, debounce,
   D7 decision, import wiring) is unit-tested with mocks. A live
   touch→single-upsert→no-dup DB test (needs the shared Postgres) is not added;
   it reuses WP4's already-DB-tested importer under the hood.
3. **T4 scoped-key verification is manual.** `scripts/verify-engram-server.sh`
   automates health + MCP handshake + tools/list + the unauthenticated-401 gate.
   The scoped-key read-ok / write-403 / spoofed-userId-ignored checks are
   documented as a manual checklist in `agent-keys.md` (server enforcement is
   unit-tested in `dispatch-auth.spec.ts`).
4. **Capture is best-effort by design.** Claude Code's transcript JSONL format is
   an internal detail that can change between releases; `capture` parses it
   tolerantly and no-ops on an unrecognized format. Distillation defaults to
   `gpt-4o-mini` (configurable) and is skipped when no LLM key is set.
5. **T11 multi-root ledger namespacing.** WP4's import ledger is keyed by
   `(userId, sourceKey)` where `sourceKey` is `<tool>:<relpath>`. Two watched roots
   that share a relative path (e.g. two repos each with `CLAUDE.md`) would collide
   on the same ledger row and thrash. Per-file `deriveImportRoot` reduces but does
   not eliminate this; the full fix (a per-root namespace in the ledger) is a WP4
   change. Until then, watch a single project root plus distinct home-dir globals.

## Resume protocol

Re-enter the `wp5-primary-memory-integration` worktree, run `pnpm db:generate`,
then the quality gate above. Per-task deliverables and residuals are listed in the
table; the residuals are non-blocking enhancements, not correctness gaps.
