---
title: Memory Platform Suite — Cross-Cutting Gaps
description: Cross-WP gaps analysis (G1–G12) plus per-agent findings (A1–A35) for the 2026-07 memory-platform suite
---

# Cross-Cutting Gaps — Things the Six Work Packages Don't Ask For (But Should)

Analysis of what qp's six asks (marketing validation, memory UI, markdown export,
agent-memory import, primary-memory integration, developer docs) leave uncovered.
Each gap states why it matters and where it should land. Treat these as candidate
WP7+ items or as sections to fold into existing WPs at execution time.

> **Medium gaps G5–G9 remediated 2026-07-09.** After WP2–5 shipped, most of the
> medium tier was already satisfied by merged code; the genuine remainder was
> closed on branch `feat/gaps-medium-g5-g9`. Each gap below carries a
> **Status (2026-07-09)** line. Net: G5/G6/G9-backup closed with code; G8 already
> shipped (DRY cleanup only); G7 substantially closed (two optional-hardening
> sub-items deferred with rationale); G9 hosted-TLS remains WP6-owned.

## G1 — Per-user/per-agent authentication and authorization (critical)

Today the only auth is `MCP_ADMIN_TOKEN` for admin tools; regular memory tools trust
the `userId` field in the request. The moment WP2 exposes edit/delete in a UI and WP5
makes five different agents write to one server, an unauthenticated `userId` is a
spoofable free-for-all. Needs: per-agent/per-user API keys or OAuth on the MCP
transport, scopes (read vs write vs admin), and authz checks in every tool handler.
Lands in: prerequisite for WP2 + WP5; fold into both plans' schema/prereq sections.

## G2 — Secret and PII scanning on import (high)

Instruction files being imported by WP4 (CLAUDE.md, .cursor/rules, copilot-instructions)
routinely contain API keys, internal hostnames, and personal data. Importing them into a
server-side store (and embedding them via OpenAI!) is an exfiltration hazard. Needs: a
redaction/secret-scan pass in the import IR pipeline, an `EMBEDDING` exclusion flag per
memory, and a documented policy. Lands in: WP4 pipeline stage + WP5 write-policy rubric.

## G3 — Memory lifecycle: dedup, consolidation, decay, contradiction (high)

WP5 turns on the firehose (agents auto-storing every session) with no plan for what
happens after six months: near-duplicate facts, stale facts, contradictory facts stored
by different agents. Needs: periodic consolidation job (cluster near-duplicates via
existing vector search, merge/supersede), staleness review (last-recalled-at tracking),
and a contradiction policy (latest-wins vs both-kept-flagged). Lands in: new WP7;
`packages/memory-ltm` + a scheduled job in `apps/mcp-server`.

## G4 — Concurrent-writer safety (high)

qp runs multiple agents simultaneously (per stored memory). Two agents editing/importing
the same memory concurrently (or UI edit racing an agent update) has no defined outcome.
Needs: optimistic concurrency (version column checked on update), and idempotency keys on
import. Lands in: SHARED schema task consumed by WP2 and WP4.

## G5 — Edit history / soft delete (medium)

WP2's edit and delete are destructive; an agent (or qp) can silently wipe a memory that
other agents depend on. Needs: `MemoryRevision` table (or soft-delete + `deletedAt`),
restore path, and the audit trail WP2 mentions made queryable from the UI.
Lands in: WP2 schema section; export (WP3) should optionally include history.

**Status (2026-07-09): CLOSED.** Recoverability was already delivered by WP2's
`MemoryAudit` trail (update/delete/bulk-delete/promote/reembed/restore) + a working
restore-by-original-id path + a UI History panel with per-entry restore. A
`deletedAt`/`MemoryRevision` column was deliberately NOT added — hard-delete +
audit-snapshot is the documented mechanism (`prisma/schema.prisma` MemoryAudit
comment), so a soft-delete column would be redundant. The sole open sub-requirement,
"export (WP3) optionally includes history", was implemented as the opt-in
`includeHistory` export flag (audit sidecar under `_history/`).

## G6 — Export→import round-trip guarantee (medium)

WP3 (export) and WP4 (import) define the same frontmatter/wikilink contract from two
sides. Without a single canonical schema module + a CI round-trip test
(export N memories → import into clean DB → diff), the two will drift. Needs: shared
contract package (e.g. `packages/memory-interchange`) + e2e round-trip test.
Lands in: prerequisite task shared by WP3/WP4.

**Status (2026-07-09): CLOSED.** The shared contract package
(`packages/memory-interchange`, Prisma/NestJS-free), the parse-side round-trip proof,
and the `MemoryLink` idempotency constraint (SHARED-1) were all already shipped. The
open piece — a real DB-backed round-trip test — was implemented: `export-roundtrip.e2e-spec.ts`
now seeds a durable edge, exports a vault, re-imports into a clean tenant, and asserts
content/type/durable-link topology round-trip + import idempotency (it also asserts
≥1 durable edge survives, so it cannot pass vacuously). The test surfaced and fixed a
real fidelity bug: the markdown importer accreted ENGRAM's `## Related` mirror into
stored content; it now strips it at `RELATED_MARKER`.

## G7 — Embedding cost and rate control on bulk operations (medium)

A first-time WP4 import of years of agent memory, or WP2 bulk edits, will fire thousands
of OpenAI embedding calls despite the Redis cache (cold cache on new content). Needs:
batch embedding API usage, rate limiting, cost estimate in dry-run output, and a
documented "import with EMBEDDING_PROVIDER=local, then reindex" path (reindex is
cursor-resumable already). Lands in: WP4 tasks + docs (WP6 operations section).

**Status (2026-07-09): SUBSTANTIALLY CLOSED — two sub-items deferred.** The cost
estimate in dry-run output (`estimateEmbeddingCost`) and the documented
"import with `EMBEDDING_PROVIDER=local`, then reindex" path (`docs/IMPORT.md`
"closes G7", `docs/agent-memory-migration.md`) shipped with WP4 — this is the
codebase's chosen rate-control story. **Deferred (optional throughput hardening,
not correctness):** (a) batch embedding API and (b) a proactive tokens/min limiter.
Rationale: import embeds one memory at a time via `ltm.create`, so only the
cursor-resumable reindex path would benefit; OpenAI's embedding rate limits are high;
and the mitigation path already bounds cost. Revisit only if a real years-of-history
bulk import empirically shows an embedding-throughput bottleneck (target the reindex
loop as the batching seam; no migration needed).

## G8 — Recall quality regression gate (medium)

`packages/eval` already scores retrieval quality (precision@k, recall@k, MRR, nDCG).
Nothing ties it to WP5: if Engram becomes primary memory and recall quality regresses,
every agent gets dumber silently. Needs: seeded eval dataset from real (sanitized)
memories, eval run in CI, thresholds as release gate (RELEASE_GATES.md precedent exists).
Lands in: WP5 acceptance criteria + CI task.

**Status (2026-07-09): CLOSED (shipped with WP5) — fixture-provenance deferred.** The
threshold-enforcing gate (`packages/eval` `thresholds.ts`/`gate.ts`), the CI job
(`ci.yml` runs `pnpm eval` + `pnpm eval:gate` in the required `test` job), and the
`docs/RELEASE_GATES.md` "Recall quality gate" section all landed with WP5 (#227). This
PR only did a DRY cleanup: `run.ts` now reuses `RECALL_GATE_THRESHOLDS`/`evaluateGate`
instead of duplicating the floors, so the two CI checks share one source of truth.
**Deferred:** sourcing the eval dataset from real (sanitized) memories instead of the
hand-authored fixtures — optional, privacy-sensitive, and would risk re-pinning a gate
that already catches regressions today.

## G9 — Server reachability and deployment story for "primary memory" (medium)

WP5 assumes every agent on every machine can reach one Engram server. Local-only
(localhost:3000) means memory silos per machine; hosted means TLS, backup, uptime.
The nightly backup/restore verification exists — new tables from WP2-4 (links, revisions,
provenance) must be added to that verification. Lands in: WP5 risks + ops docs (WP6);
backup coverage check as an explicit task.

**Status (2026-07-09): backup coverage CLOSED; hosted-TLS remains WP6-owned.**
`scripts/backup.sh` already does a whole-DB `pg_dump` (no table allowlist), so the new
WP2-4 tables are physically captured. The gap was a missing test _assertion_: the
backup-restore verification only checked a synthetic sentinel table. Both legs now seed
and assert `memory_links` / `memory_audits` / `memory_import_sources` round-trip through
backup→restore — the PR-gated `backup-restore.spec.ts` and the nightly
`backup-verify.yml` (which now provisions the real schema first) — so a future dump
narrowing that drops them reddens CI. The single-server reachability + backup/DR ops
docs already exist; the **hosted/cross-host TLS reachability** substance stays deferred
to WP6 by design (`docs/agent-memory-server.md` "do not widen the bind" note), not
buildable now.

## G10 — Observability of memory operations (low)

OTel wiring exists (`OTEL_EXPORTER_OTLP_ENDPOINT`) but there's no plan for
memory-specific metrics: store/recall rates per agent, recall hit-rate, import
failure counts, vector-store drift after deletes. Without this qp can't tell whether
"primary memory" is actually being used by each agent. Lands in: WP5 task + WP6 docs.

## G11 — Marketing site and docs sharing one source of truth (low)

WP1 will find drift between site claims and reality; WP6 builds a docs app. If the
marketing site's feature claims/install snippet aren't generated from (or CI-checked
against) the same source the docs use, drift recurs immediately. Needs: shared content
source or a CI check (extend `docs:check`). Lands in: WP1 remediation + WP6 pipeline.

## G12 — Retention/TTL interaction with UI and export (low)

STM entries expire (Redis TTL, `expiresAt`); `BACKUP_RETENTION_DAYS` prunes backups.
WP2's UI editing an STM item and WP3's export need defined behavior for
about-to-expire/expired items (edit extends TTL? export includes STM at all by
default?). Lands in: WP2/WP3 design decisions — both plans must answer explicitly.

## Additional gaps surfaced by WP agents

<!-- RESUME NOTE: gaps from completed WPs are merged below as they land. For any WP
marked done in README.md but missing here, re-derive by skimming that WP
deliverable's Risks section. -->

### From WP1 (marketing-site validation)

- **A1** — `CNAME` exists only in the deployed `dist/`, not in
  `apps/marketing-site/public/` — any CI Pages deploy from source silently drops the
  `engram.events` custom domain.
- **A2** — Doc/code drift in tool counts: root README says "19-tool MCP surface";
  `memory.controller.ts:74-96` implements 20 (21 with `ping`). WP6's auto-generated
  reference is the durable fix.
- **A3** — `CLAUDE.md:16` pins `pnpm@11.4.0` vs `package.json` / README `pnpm@11.5.0`.
- **A4** — Deployed marketing bundle differs from a fresh build of current source
  (177 bytes) — no provenance link between deployed artifact and commit.
- **A5** — Dev tooling ships to production visitors: TweaksPanel + `window.__haze`
  debug handle + a `postMessage` to `window.parent` on every page load.
- **A16** — No published artifact backs the install promise: the site implies
  one-command setup but no npm package or MCP registry entry named `engram` exists.
  Go-to-market gap, not copy — needs a published package or explicit self-hosted
  framing.
- **A17** — Marketing site is intentionally excluded from the pnpm workspace
  (`pnpm-workspace.yaml:3`, `!apps/marketing-site`) and therefore from all monorepo
  CI (lint/typecheck/audit). The exclusion is undocumented; dependency
  vulnerabilities or breaking changes there surface nowhere.

### From WP2 (memory UI)

- **A6** — STM is entirely invisible to the UI today: STM lives only in Redis with no
  Postgres row, so the existing `short-term` type filter can never return data.
  Surfacing it needs a new MCP read seam, not a tweak.
- **A7** — Audit logging must live in `memory-ltm`/`apps/mcp-server`, not `apps/web`:
  only the MCP server sees agent-originated deletes, and the web DB role is intended
  read-only (#206). UI-level audit would miss every non-console destructive op.
- **A8** — STM edit silently restarts the TTL clock
  (`packages/memory-stm/src/memory-stm.service.ts:166-181`): editing a nearly-expired
  note makes it near-permanent. Concrete instance of G12.
- **A9** — Editing during an embeddings outage leaves the vector pointing at old
  content with no signal; recall stays stale until manual reindex.
- **A10** — `deleteMemory` returns `{deleted:true}` unconditionally
  (`apps/web/server/backend/prisma-backend.ts:395`) — false success on already-gone
  rows; cross-tenant deletes under a `tenant-limited` key fail as confusing
  not-found instead of a clear authz block.

### From WP3 (markdown export)

- **A11** — Derived-vs-durable edge classification is the crux of export/import:
  duplicate/contradiction matches are regenerable, insight edges are not. Without
  SHARED-1's unique constraint, WP4 re-import silently doubles derived edges and the
  round-trip test cannot pass by construction.
- **A12** — Filtered exports need an explicit dangling-edge policy (WP3 chose
  plain-text rendering) or Obsidian spawns phantom notes.
- **A13** — Returning exports as base64 zip through the MCP text channel blows the
  token budget at scale — WP3 chose path-reference mode instead.
- **A14** — Export inherits the G1 auth hole: with caller-trusted `userId`, an
  unauthenticated MCP export can read another tenant's memories wholesale.
- **A15** — `packages/memory-interchange` must stay Prisma/NestJS-free so importers
  (WP4) can depend on it without pulling in the server; metadata→edge mapping belongs
  in the app layer.

### From WP4 (agent-memory import)

- **A18** — The MCP import tool reads the _server's_ filesystem and bulk-writes:
  admin-token gating is necessary but not sufficient — path-traversal/allowlist
  constraints on the server-side `path` argument are unspecified (ties to G1).
- **A19** — No import undo: without soft-delete (G5) a bad bulk import has no clean
  revert. The `MemoryImportSource` ledger enables a "delete this importBatchId"
  path — worth an explicit task.
- **A20** — AGENTS.md is a shared de-facto standard across tools: the Codex and
  generic adapters can double-import the same file; handled by explicit `source`
  selection, but fragile without operator discipline.
- **A21** — The plan sends everything to LTM; genuinely ephemeral session-scoped
  memory from some tools may not belong in a durable store at all.
- **A22** — A multi-source merged memory needs an agreed `provenance.sources[]`
  shape so WP3 export can round-trip it back to N source files (open question
  flagged for WP3/WP4 reconciliation).

### From WP5 (primary-memory integration)

- **A23** — Memory poisoning / inbound prompt-injection: auto-captured untrusted
  transcript or file content gets recalled later as "fact" and acted on. Distinct
  from G2 (outbound secrets). Needs trust-level provenance, untrusted-data framing
  on recall, and a human-review gate for imports from cloned repos.
- **A24** — Cross-agent scope-key alignment: the shared store only shares if all
  five agents compute `project:<slug>` identically — `basename(cwd)` vs git-root
  divergence silently fragments recall. WP5 D2 standardizes on
  `basename(git rev-parse --show-toplevel)`.
- **A25** — Multi-writer contradiction _amplification_: agent A stores a wrong
  fact, agent B recalls and re-stores it reinforced — G3 escalates into a loop
  that is new to the multi-agent-writer setup.
- **A26** — Key distribution/onboarding toil: five agents × N machines with no
  provisioning automation; per-machine secret sprawl and key rotation unhandled.
- **A27** — Distillation model dependency: the SessionEnd backstop needs an LLM to
  distill transcripts; which provider/model, its cost, and the privacy of sending
  transcripts to it are open policy questions.

### From WP2 v2 (rewrite by resumed agent — deeper server-side verification)

- **A28** — `get_memory`, `list_memories`, `promote_memory` are **not `delegable`**
  (`memory.controller.ts:1086-1130`): the console's admin API key is silently pinned
  to its own tenant for those tools. Any WP relying on console reads of STM or
  promote hits this wall today.
- **A29** — `list_memories` drops its `type` filter (`memory.controller.ts:242-251`)
  and the STM+LTM merge re-injects STM rows on every page
  (`memory.service.ts:404-456`) — WP4 importers or WP3 export using this tool for
  enumeration will double-count.
- **A30** — Core tool dispatch passes no actor context to handlers
  (`packages/core/src/mcp/tools/index.ts:296-299`). WP2 audit, WP4 provenance, and
  WP5 per-agent attribution all need the same `ToolCallContext` change — coordinate
  on ONE signature or three competing ones will collide.
- **A31** — Two Prisma clients (web `WEB_DATABASE_URL` vs mcp-server `DATABASE_URL`)
  assume one Postgres instance; introducing a read replica breaks read-after-write
  in the web update flow (update via MCP → immediate Postgres re-read).

### From WP6 (developer docs)

- **A32** — `@engram/config` exports only `envSchema`, which is a `ZodEffects`
  (post-refine) and cannot be introspected field-by-field. The env-var reference
  generator needs a small additive change first: `export const baseSchema`
  (`packages/config/src/index.ts:6`).
- **A33** — Roughly 20 env vars are read via `process.env` directly and bypass the
  config schema entirely (`MCP_ADMIN_TOKEN`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `LOG_LEVEL`, `CORS_ALLOWED_ORIGINS`, `METRICS_TOKEN`, `QDRANT_API_KEY`, …).
  True configuration surface is ~52 vars, not the ~32 in the schema — the docs
  generator emits a supplementary "not schema-validated" table, but folding them
  into the schema is the durable fix.
- **A34** — Doc-drift gates only work if generators are deterministic: zero
  timestamps or run-IDs in generated output, or CI fails on every run. Applies
  equally to WP3's deterministic-export requirement.
- **A35** — Static-hosting base-path risk: Starlight search (Pagefind) under
  `base: '/docs'` on GitHub Pages needs verification up front (T1), with a
  documented fallback strategy if it fights the merged-artifact deploy.
