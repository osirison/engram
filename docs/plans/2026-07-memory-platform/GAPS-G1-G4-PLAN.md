---
title: Cross-Cutting Gaps G1–G4 — Remediation Work-Package Plan
description: Execution-ready remediation plan for the critical/high gaps (authz, import secret-scan, memory lifecycle, concurrent-writer safety) after WP2–5 shipped, with cross-gap seams and required qp decisions
---

# Cross-Cutting Gaps G1–G4 — Remediation Plan

Companion to [`GAPS.md`](./GAPS.md) (G1–G12 + A1–A35) and [`STATE.md`](./STATE.md).
This plan covers the **critical/high tier** — G1 (auth/authz), G2 (import secret/PII
scan), G3 (memory lifecycle), G4 (concurrent-writer safety) — that WP2–5 partially
addressed. It is a **gap-closing plan, not green-field**: §1 records what merged code
already delivers so we don't rebuild it, §2 defines the genuine remainder as sized tasks,
§3 pins G1 as the hard prerequisite, §4 lists the decisions qp must make before build,
§5 gives execution order + effort.

> Suite conventions (worktree-per-task rebased on `origin/main`, conventional commits with
> body ≤300 chars, never `--no-verify`, tests at BOTH service and wiring level, Zod
> `.strict()` on all tool inputs, Postgres = source of truth, `userId: "qp"` in examples)
> live in [`README.md`](./README.md) — not restated here. Read repo `CLAUDE.md` and
> `AGENTS.md` first. All paths are repo-root-relative.

---

## 1. Already closed by merged code (do not rebuild)

Line numbers below are as verified by the adversarial pass; where a verdict corrected the
original assessment, **the verdict wins** and the correction is flagged inline.

### G1 — Auth / authz: machinery built, but the safety property is OFF by default

The full stack exists and is test-backed — but its tenant-isolation guarantees hold
**only when auth is engaged**, which it is not in qp's real deployment (see the caveat).

- **Per-user/per-agent API keys** — SHA-256-hashed keys, prefix+hash lookup, scopes,
  expiry, TOCTOU-safe revoke via `updateMany`, `lastUsedAt` tracking
  (`apps/mcp-server/src/api-keys/api-keys.service.ts`; Prisma `model ApiKey`
  `prisma/schema.prisma:61`, `@@unique([hash])`). Credential parsed at
  `apps/mcp-server/src/auth/auth-resolver.service.ts:50-100`.
- **OAuth / JWT** — `packages/auth/src/oauth/{github,google}.provider.ts`, `JwtService`,
  `JwtRevocationService` (jti denylist, fail-closed). Wired profile-gated in
  `apps/mcp-server/src/auth/auth.module.ts:56-122`.
- **Scopes (read/write/delete/admin)** — `ApiKeyScope` enum
  `packages/database/src/types.ts:50-53` (verdict: 50-53, not 49-52); every tool carries
  `requiredScope` in `apps/mcp-server/src/memory/tools-manifest.ts`; dispatch rejects a
  principal missing the scope with `Forbidden: missing required scope`
  (`packages/core/src/mcp/tools/index.ts:288-294`).
- **Tenant boundary enforced once at dispatch** — client-supplied `userId` is overwritten
  by the verified `authenticatedUserId(extra)` before Zod parse
  (`index.ts:307-324`); spoof→override asserted at
  `dispatch-auth.spec.ts:109-116` (verdict: 109-116, not 118-131; the 118-131 block is the
  `.refine()` latent-trap variant — both exist).
- **Proportionate delegation** — `resolveActingUserId` (`index.ts:159-181`): only a
  principal with `admin` scope calling a `delegable:true` tool may target another tenant;
  everyone else pinned. Web parallel gate `assertCanManageUser`
  (`apps/web/server/trpc/trpc.ts:89`). A28 (get/list/promote now `delegable`) resolved.
- **Admin-token layer distinct from identity** — `assertAdminAuthorized`
  (`memory.controller.ts:212-234`, constant-time compare) gates maintenance tools only.
- **Per-key attribution/audit** — `ToolCallContext` carries `apiKeyId+scopes+delegated`
  (`index.ts:40-49`); `MemoryAudit` persists `actorType/actorId/actorLabel/delegated`
  (`memory-audit.service.ts:58-73`).
- **Prod fail-safe** — `main.ts:101-118` refuses to boot a multiTenant streamable-http
  server in production with `AUTH_REQUIRED` off unless `ALLOW_UNAUTHENTICATED_HTTP=true`.

> **CAVEAT (verdict-corrected — this is why G1 is still the critical gap).** The A14 claim
> that "an unauthenticated caller cannot export another tenant" is **FALSE in qp's real
> deployment.** The dispatch override at `index.ts:307` fires **only when authenticated**;
> `isAuthRequired()` returns false by default (`auth.config.ts:146-148`,
> `AUTH_REQUIRED` commented out in `.env.example:51`), and qp's local server runs auth-off
> enterprise on :3100. So today `userId` is fully caller-trusted, and `export_memories`
> (and every identity tool) can read/export any tenant. The scope/delegation wiring is
> correct; the **safety property is contingent on engaging auth** — which is G1-T1.

### G2 — Import secret/PII scan: default path closed, `flag` path inert (verdict: accurate)

- **First-class scan stage before persist/embed** — `SecretScanner` (14 patterns: 9
  shared with the ingest `PrivacyFilterStep` + 5 import-specific) at
  `packages/memory-import/src/secrets/secret-scanner.ts`, run at
  `memory-import.service.ts:115` before every `persistFact()`.
- **Four-mode policy end-to-end** — redact/flag/skip/fail from MCP tool + CLI to scanner
  (DTO enum `import-agent-memory.dto.ts:33`; controller `memory.controller.ts:1613-1614`;
  default `redact`; doc table `docs/IMPORT.md:84-89`).
- **Default `redact` path is safe** — redacted content is what gets embedded; no raw
  secret from body content reaches OpenAI on the default path.
- **Defense-in-depth** — the ingest `PrivacyFilterStep` (9 core patterns) is element 0 of
  the sync-steps array and runs before the `create()` embedding call regardless of import
  policy (`ingest-pipeline.service.ts:27-28,~54`; verdict confirms by execution, not just
  injection). Import requires Postgres, so this always applies.
- **Real unit coverage** — `secret-scanner.spec.ts` (191 lines) exercises all patterns and
  policy actions.

### G3 — Lifecycle: decay/dedup/contradiction built, consolidation is a misnomer (verdict: accurate)

- **On-by-default periodic decay job** — `DecayService` `setInterval` scheduler
  (`decay.service.ts:32`, 24h default, off when 0) → `applyDecayPolicy`
  (`memory-ltm.service.ts:1224-1326`): cursor-resumable, recomputes importance, marks
  `stale` (<0.3), prunes `<0.15 & age≥30d & unpinned`.
- **Genuine time-decay model** — `importance.service.ts:21` `exp(-ln2·ageDays/halfLife)`,
  half-life 14d, access boost, cue/tag/pin boosts.
- **Last-recalled/access tracking** — `recordAccessMany` after recall/search
  (`memory-ltm.service.ts:1130,1197`) writes `lastAccessedAt` into metadata JSON.
- **On-write dedup** — exact-hash short-circuit (`:142`) + vector `findMatch` at 0.97
  (`duplicate-detection.service.ts`), collapse into existing row.
- **On-write contradiction** — `ContradictionDetectionService.detect` over [0.8,0.97);
  latest-wins supersede via `markSuperseded`.
- **`Memory.version` CAS + `MemoryAudit`** — SHARED-2, migration
  `20260705190357_memory_version_and_audit`; the user-facing `update()` genuinely does CAS
  (`memory-ltm.service.ts:394-411`).

### G4 — Concurrent-writer safety: CAS + idempotency built, enforcement opt-in (verdict: accurate)

- **`version` column + LTM CAS** — always bumps `version:{increment:1}` (`:397`), folds
  `expectedVersion` into the update `where` (`:410-411`), maps P2025 →
  `LtmVersionConflictError` (`:426-431`); `where` pins id+userId+type(+org).
- **STM read-compare-set** — `memory-stm.service.ts:172-197` (documented non-atomic, ms
  window; true Lua CAS deferred).
- **`expectedVersion` threaded end-to-end** — DTO → controller → web tRPC →
  prisma-backend, conflicts mapped to 409/`CONFLICT:`.
- **UI edit sends its read version** — `memory-detail-sheet.tsx:289`; 409 surfaces a
  reload-and-rediff panel; test-backed.
- **Import idempotency** — `MemoryImportSource` ledger `@@unique([userId, sourceKey])`
  (`schema.prisma:207`) + `contentHash`; re-import of unchanged source is a no-op.
- **Bulk ops don't bypass CAS** — `bulkDeleteMemories` routes per-item through
  `deleteMemory`; no `updateMany` content path exists.
- **Promote is race-safe** — quota enforced via `pg_advisory_xact_lock` in
  `createRowWithQuota()` (`:962-987`; verdict corrects: `promote()` itself is not wrapped,
  the advisory-locked txn is in the private insert path — conclusion unchanged).

---

## 2. Genuine remainder — sized tasks

Task IDs, sizes, and `dependsOn` are carried from the assessments (verdicts do not change
task structure). **Cross-gap seams** are folded in below §2.5 — the isolated assessments
could not see these collisions.

### G1 — Engage auth + per-agent provisioning

- **G1-T1 · S · critical — Engage auth for multiTenant deployments (close the default-off hole).**
  Make the built stack the default posture for enterprise/multiTenant. Per Decision 1:
  either default `AUTH_REQUIRED=true` when profile is multiTenant, or extend the
  `main.ts:101-118` boot fail-safe to fire for multiTenant streamable-http whenever
  `NODE_ENV!=='production'` too (requiring explicit `ALLOW_UNAUTHENTICATED_HTTP`).
  **Accept:** a multiTenant streamable-http server without `AUTH_REQUIRED` and without the
  explicit ack refuses to boot in any `NODE_ENV`; wiring spec asserts refusal;
  `.env.example` + docs document the engaged-by-default posture.
  **dependsOn:** none.

- **G1-T2 · M · high — Per-agent key provisioning + document the shared-key limitation.**
  Provisioning path (script/CLI wrapping `create_api_key`) so agents get DISTINCT keys
  (per Decision 2, optionally distinct userIds/scopes) instead of one shared key + the
  unauthenticated `ENGRAM_AGENT` label (`packages/agent-bridge/src/config.ts:47-49` —
  attribution only, not authz). **Accept:** running the flow yields N distinct `eng_` keys
  each attributable in `MemoryAudit.actorId`; docs explain `ENGRAM_AGENT` is
  attribution-only and distinct keys are required for per-agent authz; a test asserts two
  agents' ops record different `actorId`. **dependsOn:** G1-T1.

- **G1-T3 · S · high — Constrain `import_agent_memory` server-side path (A18).**
  Add an allowlist / traversal guard to the import `path` arg so an admin token cannot read
  arbitrary server files (admin gating authorizes WHO, not WHICH paths;
  `memory.controller.ts:1597`). **Accept:** import rejects paths outside a configured root
  (e.g. `IMPORT_ALLOWED_ROOT`) and rejects `..`; `dryRun` honours the same guard; spec
  covers a traversal attempt and an out-of-root absolute path. **Ownership G1 vs G2 —
  Decision 5.** **dependsOn:** none.

### G2 — Enforce embedding exclusion + scan frontmatter

- **G2-T1 · M · high — Enforce `embeddingExcluded` in `ltm.create()` and reindex().**
  Today the flag is INERT (`grep embeddingExcluded packages/memory-ltm` → 0 hits): under
  the `flag` policy the 5 import-specific patterns reach OpenAI raw, and reindex re-embeds
  them (IMPORT.md's `flag` mitigation is a confirmed bug). Gate `embeddingsService.generate()`
  on `!processedMetadata?.embeddingExcluded` in `create()` (`memory-ltm.service.ts:155-159`);
  make `resolveEmbedding()`/reindex return `[]` (counted `skipped`) for such rows.
  **Accept:** (a) a flagged `create()` never calls `generate()` (assert via **spy call
  count**, not flag value) and stores empty vector; (b) reindex over a corpus with a flagged
  row leaves its vector empty and increments `skipped`; (c) non-excluded behavior unchanged.
  **dependsOn:** none. **Blocked on Decision 3** (`flag` = store-raw vs redact-and-exclude).

- **G2-T2 · M · high — Scan frontmatter + title before storage.**
  `scanFacts` only scans `fact.content`; `buildMetadata` writes `frontmatter`/`title`
  verbatim (`memory-import.service.ts:306-307,340-363`) — secrets in YAML frontmatter land
  raw in Postgres (surfaces on recall and in WP3 export). Scan a serialized view of
  frontmatter values + title through `SecretScanner` under the same policy before storing.
  **Accept:** a Cursor `.mdc` / Copilot `.instructions.md` fixture with an api-key in
  frontmatter yields policy-appropriate metadata (no raw secret under `redact`); the
  `ir/types.ts:73` "sanitized" comment becomes true or is corrected; fixture-backed test.
  **dependsOn:** none. **Redact-vs-drop-key — Decision 6.**

- **G2-T3 · S · high — Correct IMPORT.md flag/reindex claims.**
  After G2-T1, update `docs/IMPORT.md:91-96`: `flag` genuinely keeps content out of the
  provider at both create and reindex; remove the incorrect standalone reindex-honors claim.
  **Accept:** `docs:check` passes; the redact/flag/skip/fail table matches enforced
  behavior. **dependsOn:** G2-T1.

### G3 — Recall filter + consolidation + lifecycle CAS

- **G3-T1 · S · critical — Exclude/flag superseded memories in the recall path.**
  `markSuperseded` only writes `status='superseded'` to metadata JSON; `semanticSearch`
  (`memory-ltm.service.ts:1116-1131`) and `recall` (`:1197`) apply **no status filter**, so
  a superseded wrong fact still surfaces. Default-drop (or heavily demote) `superseded` rows;
  add opt-in `includeSuperseded` threaded from recall/reflect/forget/compress*context.
  **Accept:** superseded fact no longer in default recall/reflect; test seeds active+superseded
  and asserts default-excludes / opt-in-includes; row still retrievable via `get_memory`.
  **dependsOn:** none. *(Lowest-effort, highest-impact remainder.)\_

- **G3-T2 · L · critical — Periodic corpus consolidation job (near-duplicate clustering).**
  The tool named `consolidate_memories` is STM→LTM promotion — NOT corpus consolidation; the
  [0.8,0.97) near-duplicate band accumulates unbounded (the 6-month firehose problem). Add
  `packages/memory-ltm` `CorpusConsolidationService` (cursor-resumable like
  `applyDecayPolicy`): for each row, vector-search same user/scope, cluster hits in
  [mergeThreshold, dupThreshold), keep most-recent/highest-importance, mark losers
  `superseded`, union tags, link via `MemoryLink`. Add a `DecayService`-style scheduled
  wrapper + a dry-run-capable admin MCP tool. **Accept:** N near-dupes in [0.85,0.95] collapse
  to 1 canonical + N-1 superseded+linked; dry-run reports without mutating; idempotent +
  cursor-resumable; service- and tool-level tests. **dependsOn:** G3-T1, G3-T4. **Merge
  semantics + cadence + review gate — Decisions 8, 9.**

- **G3-T3 · M · critical — Route lifecycle metadata writes through version CAS + audit.**
  `applyDecayPolicy` (`:1304`), `recordAccess` (`:1768`), `markSuperseded` (`:1708`),
  `linkDuplicateAndReturn` (`:1745`) all issue raw `prisma.memory.update` with no version
  bump and no audit — a concurrent user edit (which does CAS) is silently clobbered, and
  lifecycle mutations are invisible to audit/restore. Route through WP2's version-checked
  helper; emit `MemoryAudit` via `ToolCallContext` where a user-visible mutation occurs
  (prune-delete, supersede). **Accept:** interleaving test asserts no lost update; prune +
  supersede produce restorable audit rows; `recordAccess` stays best-effort/non-fatal.
  **dependsOn:** none. **Cross-seam with G4 (CAS helper) and G1-T2 (actor signature).**

- **G3-T4 · M · high — Both-kept-flagged contradiction policy + review surface.**
  `ContradictionAction='superseded'|'flagged'` is declared but `detect()` always returns
  `superseded`. Add `MEMORY_CONTRADICTION_POLICY` (supersede|flag); on `flag`, keep both rows
  and set `status='contradicted'`/review metadata without collapsing; ensure G3-T1's filter
  surfaces `contradicted` with a flag rather than silently dropping. **Accept:** policy=flag
  keeps both rows flagged+linked; policy=supersede unchanged; both covered. **dependsOn:**
  G3-T1. **Policy default — Decision 7.**

- **G3-T5 · S · high — Validate + document G3 lifecycle config vars.**
  `MEMORY_DECAY_*`, `MEMORY_DUPLICATE_THRESHOLD`, `MEMORY_CONTRADICTION_THRESHOLD(_MAX)`,
  `MEMORY_IMPORTANCE_HALF_LIFE_DAYS` are parsed raw from `process.env` and absent from the
  validated schema. Add to `packages/config/src/env.schema.ts` with bounds + defaults matching
  current inline fallbacks; add to `.env.example` + docs env table; services read validated
  config. **Accept:** invalid values rejected/coerced at boot (test); defaults unchanged;
  env-table drift gate passes. **dependsOn:** none. _(Shares the config-schema seam with
  Decision 10 / A33.)_

- **G3-T6 · M · high — Strengthen contradiction detection beyond lexical heuristics.**
  `checkHeuristics` (`contradiction-detection.service.ts:95-133`) is lexical-only and misses
  value-swaps ("editor is vim" vs "editor is emacs"). Add same-subject value-swap detection
  (subject/predicate extraction or embedding/attribute-delta); gate any LLM path behind config,
  keep lexical fallback. **Accept:** value-swap fixtures (vim→emacs, NYC→SF) detected;
  negation/polar tests still pass; no regression when embeddings/LLM unavailable.
  **dependsOn:** G3-T4. **LLM dependency allowed? — Decision 11.**

### G4 — Enforce optimistic concurrency

- **G4-T1 · S · high — Decide + document the concurrent-update policy (server semantics).**
  Short ADR answering: (a) UI already requires `expectedVersion` (keep as invariant/test);
  (b) agent `update_memory` without `expectedVersion` — remain LWW or reject/warn; (c) import
  update: source-authority-wins (current, `memory-import.service.ts:213`) vs CAS-against-agent-edit.
  **Accept:** committed decision doc referenced from GAPS.md G4; chosen default reflected in
  the tool description prose. No behavior change lands without this. **dependsOn:** none.
  **Feeds Decisions 12, 13.**

- **G4-T2 · M · high — Enforce/observe optimistic concurrency on agent `update_memory`.**
  Per G4-T1: either make `expectedVersion` required (`update-memory.dto.ts:26`) with a clear
  conflict error, or keep it optional but emit an audit/metric `blindUpdate:true` flag when
  omitted. **Accept:** test that a blind update is rejected (option a) or recorded with the
  flag (option b); the `CONFLICT` mapping (`memory.controller.ts:459-467`) stays green;
  `MemoryAudit.after` carries the version. **dependsOn:** G4-T1. **Shares the actor-signature
  seam with G1-T2 / G3-T3.**

- **G4-T3 · M · high — Apply the chosen import-vs-agent-edit concurrency policy.**
  If G4-T1 chooses CAS: extend `MemoryImportSource` (or the ledger read) to carry the
  last-written version, pass `expectedVersion` at `memory-import.service.ts:213`, and on
  conflict record a `skippedConcurrentEdit` counter instead of clobbering. If source-authority-wins:
  add a test + comment pinning the intent. **Accept:** a spec that seeds a memory, bumps its
  version out-of-band, then re-imports the changed source asserts the chosen outcome.
  **dependsOn:** G4-T1. **New migration if the ledger-version column is chosen — serialize
  after SHARED-1/2.** **Must not change the `@@unique([userId, sourceKey])` key (shared with
  G6/A19).**

- **G4-T4 · M · high — Make STM update a true atomic CAS (optional hardening).**
  Replace the read-compare-set in `memory-stm.service.ts` `update()` (`:150-207`) with a Redis
  Lua script (read version, abort on mismatch, write version+1+value+TTL atomically), closing
  the ms window (`:168-171`). **Accept:** redis-up integration test drives two interleaved
  updates at the same `expectedVersion` — exactly one succeeds, one throws
  `StmVersionConflictError`; existing STM update tests stay green. **dependsOn:** G4-T1.
  **Worth building? — Decision 14.**

### 2.5 Cross-gap shared seams (avoid collisions between parallel executors)

These are the collisions the four isolated assessments could not see. Executors MUST honor
them rather than fork.

1. **One actor signature — `ToolCallContext` (`packages/core/src/mcp/tools/index.ts:40-49`).**
   G1-T2 (per-agent attribution), G3-T3 (lifecycle audit), G4-T2 (blind-update flag) all ride
   this shape. It already carries `apiKeyId/scopes/delegated`, so G3-T3/G4-T2 are **not
   blocked** on G1-T2 — but any new field (e.g. `blindUpdate`) is added ONCE here.
   **G1-T2 owns the shape; the others consume.** This is coordination, not a hard `dependsOn`.

2. **One version-CAS helper — WP2 already shipped it** (`memory-ltm.service.ts:394-411`
   user-facing `update()`). G3-T3 routes its four raw lifecycle updates through it; G4-T2/T3
   enforce/observe it. Do NOT build a second helper. `reembed` deliberately does NOT bump
   version (`memory-ltm.service.ts:466`) — keep that consistent with audit before/after snapshots.

3. **Migration serialization.** Only **two** new migrations, both decision-gated and optional:
   G3's `status`/`supersededBy` promotion from metadata JSON to an indexed column (Decision 8's
   "where does status live"), and G4-T3's ledger `version` column. Both land **after** the
   already-applied SHARED-1 (`add_memory_link_and_import_source`) and SHARED-2
   (`memory_version_and_audit`), one PR each. Everything else in G1–G4 is code-only.

4. **Embedding seam.** G2-T1 (`embeddingExcluded` enforcement) and G3-T2 (consolidation reuses
   `vectorStore.search`) and **G7's deferred batch-embedding** all touch
   `create()`/`resolveEmbedding()`. A batch-embedding refactor MUST also honor
   `embeddingExcluded` — do not batch-embed a flagged row.

5. **Status queries scan JSON today.** G3-T1's recall filter and G3-T2/T4's status writes all
   read `metadata.status` (no column/index). If efficient status queries are needed, the
   status-column migration (seam 3) must land first — otherwise accept full JSON scans in the
   lifecycle jobs (acceptable at qp's current volume).

6. **G2 is OUTBOUND exfiltration; A23 (memory-poisoning/prompt-injection) is INBOUND.** G2-T2's
   frontmatter scan does NOT address A23's trust-provenance need — do not conflate.

---

## 3. G1 is the critical prerequisite

**G1-T1 must land first.** It is not merely one task among sixteen — it is the gate on which
the other three gaps' safety claims depend:

- G1's own tenant-isolation (export, scope enforcement, delegation, per-agent attribution) is
  **live machinery that does nothing until auth is engaged** (see §1 caveat: the dispatch
  override fires only when authenticated, and `isAuthRequired()` is false by default). Until
  G1-T1, `userId` is caller-trusted and any tool can read/export any tenant.
- **G4's concurrency guarantees are per-tenant** — without an enforced identity boundary,
  "concurrent-writer safety" protects rows that any caller can already overwrite by spoofing
  `userId`. CAS on an unauthenticated free-for-all is a lock on an open door.
- **G3's lifecycle audit (G3-T3) and G1-T2's per-agent attribution** both stamp
  `MemoryAudit.actorId` — meaningful only once callers carry a verified `apiKeyId` (G1-T1
  engages the resolver that populates it).
- **G2 is the one gap that is auth-independent** (verdict confirms no schema/identity
  interaction) — it can run fully parallel from day one.

Recommended: land G1-T1, then run G1-T2 alongside G3-T3/G4-T2 (shared actor seam), while G2
proceeds in parallel throughout.

---

## 4. Decisions needed (qp) — resolve BEFORE build

Numbered so tasks can reference them. Grouped by the four axes qp named plus the orphans.

**Auth model (G1)**

1. **Engage-auth mechanism:** default `AUTH_REQUIRED=true` for the multiTenant profile, or
   keep opt-in but extend the `main.ts:101-118` boot fail-safe to non-production too (explicit
   `ALLOW_UNAUTHENTICATED_HTTP` to run unauthenticated)? qp's local :3100 currently runs
   auth-off enterprise — engaging changes day-to-day workflow and requires keys provisioned
   first. _(Gates G1-T1.)_
2. **Per-agent identity granularity:** distinct API keys AND distinct userIds/scopes per agent,
   or one userId (`qp`) with distinct keys for attribution only, or accept the shared-key +
   `ENGRAM_AGENT`-label status quo? Decides whether "per-agent authz" is truly required.
   _(Gates G1-T2.)_

**Secret-scan strictness (G2)** 3. **`flag` semantics:** (a) exclude-from-embedding but store fully raw for human review
(requires bypassing the ingest `PrivacyFilter` — a deliberate raw-secret-in-Postgres
decision), or (b) redact-for-storage AND exclude-from-embedding (safest; `flag` then differs
from `redact` only by the flag + a has-secret tag)? The build differs materially.
_(Gates G2-T1/T3.)_ 4. **Promote the 5 import-specific patterns** (jwt/slack/env-secret/private-ipv4/internal-host)
into the shared `PrivacyFilterStep` so ALL write paths (every `remember`/`create`) get them?
Widens redaction scope platform-wide. 5. **`import_agent_memory` path-allowlist (A18) ownership:** G1 (authz) or G2 (secret/PII on
import)? Currently unowned. _(Gates G1-T3 placement.)_ 6. **Frontmatter scan mode (G2-T2):** redact matched values in-place, drop the whole offending
key, or skip the fact? Must preserve enough structure for WP3 export round-trip.

**Contradiction policy (G3)** 7. **Default contradiction policy:** latest-wins (supersede, current) or both-kept-flagged? And
is it per-scope configurable? _(Gates G3-T4 default.)_ 8. **Where does `status`/`supersededBy` live:** promote to an indexed column (migration cost,
serialize per seam 3) or keep in metadata JSON and accept full scans? 11. **Stronger contradiction detection (G3-T6):** acceptable to introduce an LLM/embedding-delta
dependency, or must it stay deterministic to preserve the "runs without external services"
property the eval harness / local provider rely on?
Also: should re-storing an existing fact REINFORCE it (current: access bump raises
importance)? For wrong facts this amplifies A25's loop — do we need a provenance/confidence
signal to counteract?

**Decay / consolidation scheduling (G3)** 9. **Consolidation merge semantics + cadence:** keep most-recent, highest-importance, or
LLM-synthesize a canonical fact (LLM cost/privacy — same open question as A27 distillation)?
Run per-user on a schedule vs triggered by write-volume? Is auto-supersede without human
review acceptable, or does bulk merge need a dry-run/review gate (it deletes/hides user data)?
_(Gates G3-T2.)_

**Concurrency (G4)** 12. **Agent `update_memory`:** require `expectedVersion` (reject blind updates) or stay opt-in
LWW with a `blindUpdate` observability flag? Agent-to-agent metadata refreshes may
legitimately want LWW. _(Gates G4-T1/T2.)_ 13. **Import update semantics** when a source file changed AND an agent edited the same memory:
source-authority-wins (current) or CAS that skips/flags the concurrent edit? _(Gates
G4-T1/T3.)_ 14. **STM Lua CAS (G4-T4):** worth closing the ms window given STM is TTL-bounded and low-stakes,
or accept the documented deferral? _(Gates whether G4-T4 is built.)_

**Config hardening (cross-cutting)** 10. **Fold `JWT_SECRET`/`AUTH_REQUIRED`/`ALLOW_UNAUTHENTICATED_HTTP` (A33) + the G3 lifecycle
vars into `@engram/config`** so misconfiguration fails fast at boot rather than silently
disabling enforcement? G3-T5 already does the lifecycle half; this extends it to auth.

---

## 5. Execution order + effort rollup

### Recommended order

1. **Decisions first.** Nothing gated builds until qp resolves §4. Auth (1,2,5), `flag`
   semantics (3), contradiction default (7), consolidation (8,9), concurrency (12,13,14) are
   hard gates.
2. **G1-T1** (engage auth) — the prerequisite; unblocks the meaningful safety of everything.
3. **Parallel band A** (after G1-T1): G1-T2, G3-T3, G4-T2 — coordinate on the one
   `ToolCallContext` actor signature (seam 1) and the one CAS helper (seam 2).
4. **Parallel band B** (independent of auth, start day one): **G2** (T1→T3, T2 parallel),
   **G3-T1** (recall filter — quick, high-impact), **G3-T5** (config), **G4-T1** (ADR).
5. **G3-T4** (contradiction policy) after G3-T1; **G3-T6** after G3-T4.
6. **G4-T3 / G4-T4** after G4-T1 (each decision-gated).
7. **G3-T2** (the sole **L**, corpus consolidation) LAST — depends on G3-T1 + G3-T4, is the
   highest blast-radius, and wants the review-gate decision (9) settled.

### Effort rollup (16 tasks — 6 S / 9 M / 1 L)

| Gap   | Tasks  | S         | M            | L      | Critical prereq    |
| ----- | ------ | --------- | ------------ | ------ | ------------------ |
| G1    | T1–T3  | 2 (T1,T3) | 1 (T2)       | 0      | **T1 gates all**   |
| G2    | T1–T3  | 1 (T3)    | 2 (T1,T2)    | 0      | auth-independent   |
| G3    | T1–T6  | 2 (T1,T5) | 3 (T3,T4,T6) | 1 (T2) | T1 quick-win first |
| G4    | T1–T4  | 1 (T1)    | 3 (T2,T3,T4) | 0      | T1 (ADR) first     |
| **Σ** | **16** | **6**     | **9**        | **1**  |                    |

Critical-tier tasks (G1-T1, G3-T1, G3-T2, G3-T3) are 1 S + 1 S + 1 L + 1 M. The single L is
corpus consolidation (G3-T2). Everything else is S/M and heavily parallelizable once §4 is
resolved and G1-T1 lands.
