---
title: Wrap-Up Campaign 2026-07-12 — Master Execution Plan
description: Orchestration plan and resumable batch tracker for finishing every outstanding item — G1–G4 gap remainder (batches 2–5), WP6 docs content (batches 6–7), WP1 marketing remediation (batches 8–9), plus housekeeping and local-ops steps
---

# Wrap-Up Campaign — Master Execution Plan (2026-07-12)

**Mission (pinned by qp, 2026-07-12): finish ALL outstanding items** across the three
open efforts, in priority order:

1. **G1–G4 gap remainder** — 12 rows in [`STATE-G1-G4.md`](./STATE-G1-G4.md)
   (11 build tasks + the G4-T4 deferral note). Task cards: [`GAPS-G1-G4-PLAN.md`](./GAPS-G1-G4-PLAN.md) §2.
2. **WP6 docs content T7a/T7b + T8–T14** — task cards: [`WP6-developer-docs/PLAN.md`](./WP6-developer-docs/PLAN.md) §6.
3. **WP1 marketing remediation R1–R13** — task cards: [`WP1-marketing-site-validation/REPORT.md`](./WP1-marketing-site-validation/REPORT.md).

Plus housekeeping (stale worktree/branch cleanup, local service ops, memory updates).
Explicitly-deferred items stay deferred: G7 batch-embed, G8 real-memory fixtures,
G9 hosted-TLS, WP2 item 6 (CI-only e2e prose), G4-T4 STM Lua CAS.

**This file is the campaign index.** The per-effort task cards are the build spec —
this file adds batch structure, decision deltas, exact commands, and the live tracker.
Any session (any model) resumes by reading §0 + §1 and picking the first non-✅ batch.

## Decisions pinned by qp (2026-07-12 — extends STATE-G1-G4.md §Decisions 1–6)

7. **G1-T2 granularity (plan Decision 2): distinct API keys per agent, ONE userId
   (`qp`).** Attribution via `MemoryAudit.actorId`; the shared memory pool stays
   intact. No per-agent userIds/tenancy split.
8. **Status storage (plan Decision 8): `status`/`supersededBy` stay in metadata
   JSON — NO status-column migration.** Lifecycle jobs accept JSON scans at current
   volume. The campaign's ONLY schema change is G4-T3's ledger version column.
9. **G3-T6 (plan Decision 11): deterministic only — no LLM dependency.** Preserves
   the "runs without external services" property. No config-gated LLM path either.
10. **Scope:** all three efforts above (qp selected all). Plan Decision 4 (promote the
    5 import-specific scanner patterns into the shared `PrivacyFilterStep`) stays
    OUT of scope — not one of the 16 tasks; revisit after the campaign.

## 0. Global execution protocol (every batch)

1. **Worktree per batch**, rebased on fresh `origin/main`:
   ```bash
   cd /home/qp/Cloud/Projects/engram && git fetch origin
   git worktree add ../engram-<batch> -b <branch> origin/main
   cd ../engram-<batch>
   pnpm install --frozen-lockfile && pnpm db:generate   # Prisma client is gitignored
   ```
   Never regenerate `pnpm-lock.yaml`. Never `--no-verify`.
2. **One conventional commit per task** (subject `type(scope): summary (GX-TY)`,
   body ≤300 chars). **Push after every commit** (`git push -u origin <branch>`) so
   nothing is lost if a session dies mid-batch.
3. **Tests at BOTH levels** for every code task: service-level (package spec) and
   wiring-level (controller/tool/DTO spec in `apps/mcp-server` or the owning app).
4. **Quality gate before the tracker flip** (repo root):
   `pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
   Marketing-site batches additionally:
   `cd apps/marketing-site && npm ci && npm run lint && npm run build`
   (the app is intentionally OUTSIDE the pnpm workspace).
5. **Last commit of each batch = tracker flip**: update the batch row in §1 here,
   flip task rows in the effort tracker (`STATE-G1-G4.md` table, or `STATE.md`
   WP6/WP1 rows), same branch.
6. **PR + merge**: open the PR right after the first pushed commit
   (`gh pr create --title "<type>(<scope>): <batch summary>" --body "..."`).
   Monitor checks (`gh pr checks <n> --watch`); fix failures; when green,
   **squash-merge** (`gh pr merge <n> --squash --delete-branch`) — matches repo
   history. qp has delegated merge-when-green for this campaign (2026-07-12).
   After merge: `git worktree remove ../engram-<batch>`.
7. **Batches run sequentially by default** (B2→B3→B4→B5→B6→B7→B8→B9). B6–B9 touch
   disjoint apps from B2–B5 and MAY be built in parallel worktrees, but merge
   serially and rebase before PR to keep tracker conflicts trivial.
8. **Resume protocol** (fresh session): read this file §1; if a batch is 🟨, `cd`
   its worktree (or re-create it and `git pull` the pushed branch:
   `git worktree add ../engram-<batch> <branch>`), read the branch log to see which
   task commits already landed, continue at the first missing task. If all rows ✅,
   run §H residuals. When a task needs a policy call not covered by pinned
   decisions (STATE-G1-G4 §Decisions 1–6 + 7–10 above), ask qp first.

## 1. Batch registry (live tracker)

Legend: ✅ merged · 🟨 in progress · ⬜ not started.

| Batch | Branch                       | Tasks                                      | Status                      | PR   |
| ----- | ---------------------------- | ------------------------------------------ | --------------------------- | ---- |
| B0    | `docs/wrapup-plan-2026-07`   | this plan + tracker updates                | ✅                          | #256 |
| BH    | (no branch — local ops)      | §H housekeeping items                      | 🟨 1–2 done; 3–5 post-merge |      |
| B2    | `feat/gaps-g1-g4-b2`         | G2-T2, G2-T3, G1-T3, G1-T1                 | ✅                          | #257 |
| B3    | `feat/gaps-g1-g4-b3`         | G3-T3, G4-T2, G1-T2                        | ✅                          | #258 |
| B4    | `feat/gaps-g1-g4-b4`         | G3-T4, G3-T6, G4-T3, G4-T4 deferral note   | ✅                          | #260 |
| B5    | `feat/gaps-g1-g4-b5`         | G3-T2 (corpus consolidation, L)            | ⬜                          |      |
| B6    | `feat/wp6-docs-content-1`    | WP6 T7a, T7b, T8, T13                      | ⬜                          |      |
| B7    | `feat/wp6-docs-content-2`    | WP6 T9, T10, T11, T12, T14                 | ⬜                          |      |
| B8    | `fix/wp1-marketing-b8`       | R2, R3, R7, R5, R6, R13, R4, R11, R1-CNAME | ✅                          | #259 |
| B9    | `fix/wp1-marketing-b9`       | R8, R12, R10 (best-effort)                 | ⬜                          |      |
| BOps  | (no branch — GitHub/DNS ops) | R1/R9 Pages TLS + HTTPS enforce            | 🟨 domain re-added 07-13; cert poller up |      |

## 2. Batch details — G1–G4 (B2–B5)

Build spec = the task card in `GAPS-G1-G4-PLAN.md` §2 (file:line pointers there).
Below: per-task decision deltas + facts verified 2026-07-12. Honor §2.5 seams:
ONE `ToolCallContext` actor shape, ONE version-CAS helper (`memory-ltm.service.ts`
`update()`), never touch `@@unique([userId, sourceKey])`.

### B2 — import-scan completion + auth engage-ready

- **G2-T2** (M): scan frontmatter values + title through `SecretScanner` under the
  import policy before `buildMetadata` stores them. Decision 6 = **redact matched
  substrings in place** (keep keys/structure for WP3 export round-trip). Under
  `flag` (Decision 3): redact + `embeddingExcluded` + has-secret review tag —
  identical to content handling shipped in G2-T1 (#255). `skip` drops the fact;
  `fail` aborts. Make the `ir/types.ts:73` "sanitized" comment true. Fixtures: a
  Cursor `.mdc` + Copilot `.instructions.md` with an API key in frontmatter; assert
  no raw secret in stored metadata under redact/flag, and `dryRun` reports the same.
- **G2-T3** (S, after G2-T2): rewrite `docs/IMPORT.md` ~lines 84–96 policy table to
  match enforced behavior (create AND reindex honor `embeddingExcluded` since
  G2-T1; frontmatter/title now scanned). `pnpm docs:check` green.
- **G1-T3** (S): guard `import_agent_memory`'s `path` (controller ~`:1597`). New
  validated env var `IMPORT_ALLOWED_ROOT` (add to `packages/config/src/env.schema.ts`
  - `.env.example` + docs env table; default = server process `$HOME`). Resolve via
    `fs.realpath` and reject anything outside the root (catches `..` and symlink
    escapes); `dryRun` honors the same guard. Specs: traversal attempt, out-of-root
    absolute path, inside-root success.
- **G1-T1** (S): in `apps/mcp-server/src/main.ts` fail-safe (~`:98–118`), **remove
  the `NODE_ENV==='production'` condition** — a multiTenant streamable-http boot
  without `AUTH_REQUIRED` now requires explicit `ALLOW_UNAUTHENTICATED_HTTP=true`
  in EVERY env. Add `ALLOW_UNAUTHENTICATED_HTTP: booleanFlag(false)` to the env
  schema (AUTH_REQUIRED/JWT_SECRET are already validated there — A33 is half-done).
  Update `.env.example` + `docs/SETUP.md`/`docs/security/agent-keys.md` with the
  engaged-by-default posture. Wiring spec asserts dev-mode refusal without the ack.
  ⚠️ **Ops coupling: §H item 3 MUST be done before qp's local server restarts onto
  a build containing this change** (`engram-mcp.service` runs enterprise/auth-off
  streamable-http on :3100 by design — Decision 1).

### B3 — actor/CAS seam band

- **G3-T3** (M): route `applyDecayPolicy` (`:1304`), `markSuperseded` (`:1708`),
  `linkDuplicateAndReturn` (`:1745`), `recordAccess` (`:1768`) through the existing
  version-CAS update path (bump `version`, `where` carries expected version); on
  `LtmVersionConflictError` re-read + retry once, else skip that row (never clobber
  a concurrent user edit). `recordAccess` stays best-effort (catch + debug-log).
  Emit `MemoryAudit` for user-visible mutations only (prune-delete, supersede) with
  a system actor (`actorType:'system'`, `actorId:'ltm_decay'|'dedup'|…`).
  Interleaving spec proves no lost update; prune/supersede audits are restorable.
- **G4-T2** (M): Decision (pinned #3) = **reject blind updates**. Make
  `expectedVersion` required in `update-memory.dto.ts` with an error message that
  tells the agent to `get_memory` → retry with the fresh version. Keep the
  `CONFLICT:` mapping (`memory.controller.ts:459-467`) green; `MemoryAudit.after`
  carries the new version. Update the tool description prose + docs
  (`docs/concurrency-policy.md` already pins the semantics). Check `agent-bridge`
  and web tRPC callers all send `expectedVersion` (web does since WP2 T4).
- **G1-T2** (M): Decision 7 = distinct keys, one userId. Read
  `docs/security/agent-keys.md` FIRST (it exists; extend, don't fork). Build a
  provisioning CLI in `apps/mcp-server` (pattern: the existing `reindex` CLI):
  `pnpm --filter mcp-server provision-agent-keys -- --agents claude-code,cursor
--scopes read,write,delete` → N distinct `eng_` keys (printed once) under
  userId `qp`. Docs: `ENGRAM_AGENT` label (`packages/agent-bridge/src/config.ts:47-49`)
  is attribution-only; distinct keys are required for per-agent authz. Wiring spec:
  ops via two different keys record different `MemoryAudit.actorId`.

### B4 — contradiction policy + import concurrency (contains the campaign's ONE migration)

- **G3-T4** (M): new validated env `MEMORY_CONTRADICTION_POLICY` (`supersede`|`flag`,
  **default `flag`** per pinned Decision 3 — conservative, never-lose-data). On
  `flag`: keep BOTH rows, set `metadata.status='contradicted'` + review metadata +
  `MemoryLink` between them (status stays in metadata JSON per Decision 8). Ensure
  the G3-T1 recall filter (shipped in #255) does NOT drop `contradicted` rows —
  they surface WITH the flag. `supersede` path unchanged and still tested.
- **G3-T6** (M, after G3-T4): Decision 9 = deterministic only. Extend
  `checkHeuristics` (`contradiction-detection.service.ts:95-133`) with same-subject
  value-swap detection: extract subject/value from copular and preference patterns
  ("X is Y", "X = Y", "prefers/uses X"), normalize subjects, flag same-subject +
  different-value pairs inside the similarity band. Fixtures: vim→emacs, NYC→SF;
  negation/polar suite stays green; zero new external dependencies.
- **G4-T3** (M): pinned Decision 5 = **CAS-skip**. Migration (serialize; the only
  one): `MemoryImportSource.lastWrittenVersion Int?` —
  `pnpm db:migrate -- --name add_import_source_last_written_version`. DO NOT touch
  `@@unique([userId, sourceKey])`. Import update path (`memory-import.service.ts:213`):
  pass `expectedVersion: ledger.lastWrittenVersion`; on conflict SKIP + increment
  `summary.skippedConcurrentEdit`; on success write back the row's new version to
  the ledger. Spec: seed → out-of-band agent edit (version bump) → re-import
  changed source → skipped + counted, agent edit intact.
- **G4-T4 deferral note** (doc-only): STATE-G1-G4 row 15 → "deferred (Decision 14)";
  confirm `docs/concurrency-policy.md` + `GAPS.md` G4 status say the same.

### B5 — corpus consolidation (the L, highest blast radius, LAST of the gaps)

- **G3-T2**: new `CorpusConsolidationService` in `packages/memory-ltm`
  (cursor-resumable, `applyDecayPolicy` pattern). Per row: vector-search same
  user+scope; cluster hits in `[MEMORY_CONSOLIDATION_MERGE_THRESHOLD (default 0.85),
MEMORY_DUPLICATE_THRESHOLD (0.97))`; canonical = highest importance, tie-break
  most-recent; union tags onto canonical; losers → `metadata.status='superseded'`
  - `supersededBy` + `MemoryLink` (all through the G3-T3 CAS path; JSON metadata
    per Decision 8). Admin MCP tool `consolidate_corpus` (adminToken-gated,
    **`dryRun` defaults TRUE** — review gate per pinned Decision 3) returning a
    cluster report. Scheduled wrapper `MEMORY_CONSOLIDATION_INTERVAL_MS` **default 0
    = OFF** (review-gated; qp opts in explicitly). New env vars validated + in
    `.env.example` + docs env table (G3-T5 pattern). Tests: N near-dupes collapse to
    1 + N−1 superseded/linked; dry-run mutates nothing; idempotent re-run; cursor
    resume; tool wiring (admin gate, dryRun default). Flip GAPS.md G3 status when done.

## 3. Batch details — WP6 docs content (B6–B7)

Build spec = `WP6-developer-docs/PLAN.md` §6 cards + §4.1 sitemap. Foundation
(T1–T6) merged in #243: Starlight lives in `apps/docs`, generators + drift gate in
CI. Gate for every docs task: `pnpm docs:check && pnpm --filter docs build`
(build regenerates the TypeDoc reference; run `pnpm build` first so the tools
generator has compiled output). Stub-replacement pattern is in the T7a card.

- **B6 = T7a, T7b, T8, T13** (migrations + tutorials + contributing — all parallel
  per the plan's dependency graph). ⚠️ `docs/` has grown since the plan was
  authored; fold the newcomers into the same waves where they fit naturally:
  `docs/concurrency-policy.md` → reference; `docs/security/agent-keys.md` → how-to
  (auth); `docs/agent-memory-{contract,clients,server,sync,migration}.md` →
  how-to/reference (agent-memory section); `docs/MARKETING_SITE_DOMAIN.md` stays
  in-repo (ops runbook, referenced by BOps). Every migrated original becomes a
  stub (T7a pattern) so `AGENTS.md`/`CLAUDE.md` inbound links keep resolving.
  ⚠️ `CLAUDE.md`'s "ENGRAM memory contract" section references
  `docs/agent-memory-contract.md` — keep that path a valid stub.
- **B7 = T9, T10, T11, T12, T14.** T9 architecture pages MUST describe
  post-campaign reality (contradiction policy, consolidation, CAS enforcement from
  B2–B5 — write them after B5 merges). T14 is the acceptance gate: full
  `docs:generate` + link check + Pagefind smoke + stub verification (steps in card).
  Flip STATE.md WP6 row to ✅ done+verified in the B7 tracker commit.

## 4. Batch details — WP1 marketing remediation (B8–B9 + BOps)

Build spec = `WP1-marketing-site-validation/REPORT.md` remediation cards.
Gate: `cd apps/marketing-site && npm ci && npm run lint && npm run build` (own
npm lockfile — NOT in the pnpm workspace; root `pnpm docs:check` too for R6/R13).

- **B8 (copy/SEO/a11y/docs — all S/M, same-file tasks merge in distinct line
  ranges):** R2 (replace `claude mcp add engram` with the working documented flow),
  R3 (dream-panel copy — delete "reconciles contradictions"… ⚠️ **verify against
  post-B4 reality first**: after G3-T4/G3-T6 merge, contradiction _detection +
  flagging_ genuinely exists — rewrite the panel to claim exactly what shipped,
  no more), R7 (soften "whole interface"/"every memory embedded"), R5 (a11y:
  `aria-hidden` haze, input label, `aria-live`, `--ink-faint` contrast), R6
  (rewrite stale app README), R13 (CLAUDE.md pnpm pin 11.4.0→11.5.0 + README tool
  count), R4 (meta/OG/favicon/robots/sitemap), R11 (dev-gate tweaks panel +
  `window.__haze`), **R1 in-repo part**: add `apps/marketing-site/public/CNAME`
  containing exactly `engram.events` (public/ currently has only 404.html —
  verified 2026-07-12; see `docs/MARKETING_SITE_DOMAIN.md`).
- **B9:** R8 (haze perf: tick-gated rect reads, visibility pause, sprite motes,
  drop unused font weight), R12 (prerender via `renderToString` + `hydrateRoot` —
  after B8's copy changes), R10 (Lighthouse best-effort: headless Chrome if
  available, else record as environment-blocked in the REPORT and move on).
- **BOps (R1/R9, GitHub settings — not code):** follow
  `docs/MARKETING_SITE_DOMAIN.md`. Check state: `gh api repos/osirison/engram/pages`.
  If cert stale: re-set custom domain, wait for provisioning, then
  `gh api -X PUT repos/osirison/engram/pages -f cname=engram.events
-F https_enforced=true`. Accept: `curl -sI https://engram.events` → 200 (valid
  cert), `curl -sI http://engram.events` → 301. If blocked on DNS/registrar
  access, record exact blocker in §1 and tell qp.

## H. Housekeeping (BH — do items 1–2 now; 3–5 are post-merge residuals)

1. **Stale worktree cleanup**: `feat/gaps-medium-g5-g9` was squash-merged as #254;
   worktree `/home/qp/Cloud/Projects/engram-gaps-medium` is clean (verified
   2026-07-12). Before deleting, sanity-diff:
   `git diff main...feat/gaps-medium-g5-g9 --stat` — expect only tracker-text
   deltas superseded by main. Then:
   `git worktree remove ../engram-gaps-medium && git branch -D feat/gaps-medium-g5-g9`
   (+ `git push origin --delete feat/gaps-medium-g5-g9` if it exists on origin).
2. **ENGRAM + auto-memory**: store the 2026-07-12 pinned decisions (7–10) and this
   plan's existence via `remember` (scope `project:engram`, importance high);
   update the auto-memory `project-gaps-remediation.md` pointer.
3. **Local service ack (BEFORE first local deploy of a post-B2 build):** add
   `Environment=ALLOW_UNAUTHENTICATED_HTTP=true` to `engram-mcp.service`
   (systemd user unit), `systemctl --user daemon-reload && systemctl --user
restart engram-mcp`, verify with the `ping` MCP tool. Without this, the G1-T1
   fail-safe refuses to boot qp's auth-off local server.
4. **Local redeploy at campaign end**: rebuild + restart `engram-mcp.service` on
   final main; `ping` + one `recall` smoke call.
5. **Final tracker sweep**: STATE-G1-G4.md all rows ✅/deferred; STATE.md WP1/WP6
   rows flipped; GAPS.md G1–G4 statuses updated to CLOSED (with the G4-T4
   deferral noted); this file's §1 all ✅.
