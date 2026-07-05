# Cross-Cutting Gaps — Things the Six Work Packages Don't Ask For (But Should)

Analysis of what qp's six asks (marketing validation, memory UI, markdown export,
agent-memory import, primary-memory integration, developer docs) leave uncovered.
Each gap states why it matters and where it should land. Treat these as candidate
WP7+ items or as sections to fold into existing WPs at execution time.

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

## G6 — Export→import round-trip guarantee (medium)

WP3 (export) and WP4 (import) define the same frontmatter/wikilink contract from two
sides. Without a single canonical schema module + a CI round-trip test
(export N memories → import into clean DB → diff), the two will drift. Needs: shared
contract package (e.g. `packages/memory-interchange`) + e2e round-trip test.
Lands in: prerequisite task shared by WP3/WP4.

## G7 — Embedding cost and rate control on bulk operations (medium)

A first-time WP4 import of years of agent memory, or WP2 bulk edits, will fire thousands
of OpenAI embedding calls despite the Redis cache (cold cache on new content). Needs:
batch embedding API usage, rate limiting, cost estimate in dry-run output, and a
documented "import with EMBEDDING_PROVIDER=local, then reindex" path (reindex is
cursor-resumable already). Lands in: WP4 tasks + docs (WP6 operations section).

## G8 — Recall quality regression gate (medium)

`packages/eval` already scores retrieval quality (precision@k, recall@k, MRR, nDCG).
Nothing ties it to WP5: if Engram becomes primary memory and recall quality regresses,
every agent gets dumber silently. Needs: seeded eval dataset from real (sanitized)
memories, eval run in CI, thresholds as release gate (RELEASE_GATES.md precedent exists).
Lands in: WP5 acceptance criteria + CI task.

## G9 — Server reachability and deployment story for "primary memory" (medium)

WP5 assumes every agent on every machine can reach one Engram server. Local-only
(localhost:3000) means memory silos per machine; hosted means TLS, backup, uptime.
The nightly backup/restore verification exists — new tables from WP2-4 (links, revisions,
provenance) must be added to that verification. Lands in: WP5 risks + ops docs (WP6);
backup coverage check as an explicit task.

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
