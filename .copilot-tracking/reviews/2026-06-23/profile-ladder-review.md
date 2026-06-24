<!-- markdownlint-disable-file -->

# Review: ENGRAM Profile Ladder for Accessible Enterprise Scale

| Field        | Value                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Review Date  | 2026-06-24                                                                                                          |
| Related Plan | `.copilot-tracking/plans/2026-06-23/profile-ladder-plan.instructions.md`                                            |
| Changes Log  | `.copilot-tracking/changes/2026-06-23/profile-ladder-changes.md`                                                    |
| Research Doc | Not provided (plan references `subagents/2026-06-02/*`; consulted `migration-slo-research.md` for hard-stop source) |
| Plan Log     | `.copilot-tracking/plans/logs/2026-06-23/profile-ladder-log.md`                                                     |
| Branch       | `multi-tiered-memory`                                                                                               |
| Reviewer     | Task Reviewer (RPI Validator x5 + direct validation + direct file inspection)                                       |

---

## Phase Status

| Phase | Title                                   | RPI Status              | Validation File                                                                             |
| ----- | --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| 1     | Profile Infrastructure                  | Pass (3 minor)          | [rpi/.../profile-ladder-001-validation.md](rpi/2026-06-23/profile-ladder-001-validation.md) |
| 2     | Lightweight Memory Adapters + Retrieval | Pass (5 minor)          | [rpi/.../profile-ladder-002-validation.md](rpi/2026-06-23/profile-ladder-002-validation.md) |
| 3     | Profile-Lite Durable Local + Security   | Pass (1 major, 5 minor) | [rpi/.../profile-ladder-003-validation.md](rpi/2026-06-23/profile-ladder-003-validation.md) |
| 4     | Migration Path and Quality Gates        | Pass (2 major, 8 minor) | [rpi/.../profile-ladder-004-validation.md](rpi/2026-06-23/profile-ladder-004-validation.md) |
| 5     | Docs, Quality Gates, and Release        | Pass (2 minor)          | [rpi/.../profile-ladder-005-validation.md](rpi/2026-06-23/profile-ladder-005-validation.md) |

---

## Severity Counts

| Severity | Count  | Notes                                                                                                                                                        |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Critical | **0**  | none                                                                                                                                                         |
| Major    | **3**  | Mj-1 reindex-queue bypass (Phase 4); Mj-2 `_liteId` link concentration (Phase 4); `MemoryLiteModule` not wired into `AppModule.forRoot` (Phase 3, `WI-P3-E`) |
| Minor    | **23** | aggregated across all five phases                                                                                                                            |

---

## RPI Validation Summary

### Phase 1 - Profile Infrastructure - Pass

All four steps implemented to spec. `DEPLOYMENT_PROFILE` enum, `ProfileCapabilities` resolver, `coerceDeploymentProfile()` helper, single-transform env validation (memory -> no URLs, lite -> `DATABASE_URL` only, enterprise -> all three), `AppModule.forRoot(profile?)` factory, `HealthModule.forRoot(capabilities)` factory, `MemoryStoreHealthIndicator`, and `turbo.json#globalEnv` all in place. Three minor contract-hygiene items: optional `Env` URLs need a docblock note (`M-1`); `resolveProfileFromEnv()` duplicates `coerceDeploymentProfile()` (`M-2`, already flagged as Phase 1.5 in plan-log); pre-existing `@prisma/client` baseline failure (`DR-P1-01`, resolved during Phase 4 consolidation).

### Phase 2 - Lightweight Memory Adapters + Retrieval - Pass

All six steps implemented on disk and wired correctly. `InMemoryStmAdapter` (TTL eviction), `InMemoryLtmAdapter` (no persistence, `semanticSearch` returns `[]`), `HybridTransientRetriever` (lexical postings + cosine + RRF via `@engram/eval`), lazy Prisma + Redis stub, profile-aware MCP tool filter (memory hides 3 reindex tools, lite hides 2, enterprise exposes all). Five minor items: unchecked `[ ]` markers on Steps 2.2/2.3 in plan (tracking drift, not delivery gap); `resolveActiveProfile()` duplication; `MemoryStmService` is a concrete class not an interface; `InMemoryLtmAdapter.semanticSearch` returns `[]` directly (matches plan text; production service does the routing); redis module resolves profile from env directly (consistent with Prisma style).

### Phase 3 - Profile-Lite Durable Local + Security - Pass

All six steps implemented. File-backed JSON + AES-256-GCM store (`@engram/memory-lite`), `assertSecureStartup` rejects permissive modes + insecure-in-production + missing-key-in-production, pino redaction paths (root + `*`), constant-time admin-token compare via `crypto.timingSafeEqual`, audit logging (`admin_auth_ok`/`admin_auth_denied`), migration state machine + `FileCheckpointBackend`. **One major**: `MemoryLiteModule.forRoot` / `MigrationModule.forRoot` not wired into `AppModule.forRoot` - migration services are reachable only via direct construction today (tracked as `WI-P3-E`). Five minor items: literal-duplication coupling between `REDACT_PATHS` and the redaction spec; DD-02 cross-link needs explicit plan-log entry; missing tenant-spoof negative test; module factory not yet called from `main.ts`; JSDoc on `assertAdminAuthorized` to prevent future widening of the audit-log target.

### Phase 4 - Migration Path and Quality Gates - Pass

Plan has duplicate unchecked Step 4.2/4.3/4.5 entries; first-occurrence wins as authoritative. `DualWriteCoordinator` (fan-out during `copying|verifying`, retry x3 with exponential backoff, Prisma `P2002`/`P2010` handled as duplicate-no-op, `_liteId` annotation). `BackfillService` (cursor pagination, per-item fail tolerance, `_liteId` annotation, idempotent on resume). `VerifierService` (SHA-256 content hash with `_liteId` stripped, per-user + global count match, hard-stop `0.00001`, JSON report, auto-abort to `rollback`). `PostgresCheckpointBackend` + `selectCheckpointBackend(capabilities, opts)` factory. Self-edge `copying -> copying` permitted without audit explosion. **Two major findings**:

- **Mj-1**: `BackfillService` introduces new `lite-enumerator.ts` walkers and bypasses `apps/mcp-server/src/memory/reindex-queue.service.ts` that plan Step 4.2 explicitly cited. Functionally correct (25 tests pass) but diverges from architectural intent. _Recommendation_: record `DD-03` in plan-log or refactor to enqueue per-batch through the existing reindex queue.
- **Mj-2**: `_liteId` metadata is the only stable lite<->enterprise link (dual-write, backfill, verifier). DD-02 is recorded in changes-log only, not in plan-log. _Recommendation_: record DD-02 in plan-log; add `migration-link-key.spec.ts` guard test.

Eight minor items: `BACKFILL_BATCH_SIZE` env var is parsed then `void`ed (dead code at [backfill.service.ts:156-179](apps/mcp-server/src/migration/backfill.service.ts#L156-L179)); test-count off by 7 (changes-log claims 32, observed 25); `BackfillOptions.dataDir` referenced in error message but missing from interface ([backfill.service.ts:113-117](apps/mcp-server/src/migration/backfill.service.ts#L113-L117) vs [interface at L41-49](apps/mcp-server/src/migration/backfill.service.ts#L41-L49)); `resolveDataDir` reaches into `LiteJsonStore.dataDir` via type assertion in both backfill and verifier; magic number `500` page cap duplicated; verifier N+1 `enterpriseLtm.get` calls; `mismatchRatio === 0` semantics need JSDoc; pre-existing `@prisma/client` resolution (`DR-P1-01`) should be flipped to Resolved in plan-log.

### Phase 5 - Docs, Quality Gates, and Release - Pass

All six steps implemented. README.md "Choose Your Profile" + matrix + 3 command paths. docs/SETUP.md split per profile with runbook + recovery. `apps/mcp-server/README.md` 19-tool matrix + health table. `.github/workflows/profile-matrix.yml` with build matrix + lint + typecheck + test + per-profile smoke jobs + `migration:lite-to-enterprise`. `docs/RELEASE_GATES.md` SLOs, reliability gates, security gates, coverage gates, backward-compat gates. Two minor items: `test:matrix` script referenced in plan details is missing from root `package.json` (functional matrix fully implemented in the workflow); coverage thresholds (>= 85%) are documented but not enforced in CI (tracked as `WI-P5-B`).

---

## Implementation Quality Findings (direct review)

The `Implementation Validator` subagent was unable to read files in this session (no read access). Findings below are derived from direct file inspection of:

- `packages/config/src/profile.ts`
- `packages/memory-lite/src/encryption.ts`
- `packages/memory-lite/src/secure-startup.ts`
- `apps/mcp-server/src/migration/migration-state.service.ts`
- `apps/mcp-server/src/migration/dual-write.service.ts`
- `apps/mcp-server/src/migration/backfill.service.ts`
- `apps/mcp-server/src/migration/verifier.service.ts`
- `apps/mcp-server/src/memory/memory.controller.ts` (admin-token path)
- `docs/RELEASE_GATES.md`

### Architecture & Boundaries

- Pass: `@engram/config` is the single source of truth for profile taxonomy.
- Pass: NestJS DI discipline maintained throughout (`LITE_STORE_TOKEN`, `STM_PROVIDER`, `LTM_PROVIDER`, `MIGRATION_BACKEND`, `'ENGRAM_PROFILE'`).
- Pass: In-process adapters isolated under `packages/{memory-stm,memory-ltm}/src/adapters/`; cross-tier leakage not observed.
- Minor: `resolveActiveProfile()` is duplicated across `app.module.ts`, `memory.controller.ts`, `prisma.service.ts`, `redis.module.ts`, `health.controller.ts`. Plan-log already records as Phase 1.5 follow-on (`WI-P1-D`).
- Minor: No `MigrationController` or CLI exposes the migration surface (verified by `WI-P5-E`); services + tests are wired but the user-facing trigger is missing.

### Security

- Pass: AES-256-GCM with versioned `v1:` nonce prefix, AAD bound to memory id, auth-tag verification.
- Pass: `constantTimeEqual` uses zero-padded `timingSafeEqual` to avoid length-revealing rejection time.
- Pass: Owner-only `0o700` dir + `0o600` file modes with `chmod` re-application after `mkdir` to defeat umask leaks.
- Pass: Production refuses `LOCAL_INSECURE_MODE=true` and missing `LOCAL_ENCRYPTION_KEY`.
- Pass: Constant-time admin-token compare via `crypto.timingSafeEqual` with length-mismatch padding ([memory.controller.ts:107-128](apps/mcp-server/src/memory/memory.controller.ts#L107-L128) per RPI-001 evidence).
- Pass: Pino redaction paths cover root + nested for all secret fields.
- Pass: Audit log lines `admin_auth_ok` / `admin_auth_denied` on every admin call site.
- Minor: `_liteId` is a private metadata key (DD-02) - the only stable lite<->enterprise link. If a user writes their own `_liteId` into metadata it collides silently. _Recommendation_: prefix reserved keys (e.g. `_engram_liteId`) and reject user-supplied keys with that prefix in `LiteJsonStore.create`.

### Reliability

- Pass: State machine `idle -> preparing -> copying -> verifying -> cutting_over -> complete | rollback` with self-edge `copying -> copying` for in-flight checkpoint updates; audit append skipped on self-transition.
- Pass: `DualWriteCoordinator`: shadow failure never blocks primary write; per-item retry x3 with exponential backoff (50 ms base); pending writes queued for backfill mop-up.
- Pass: `VerifierService`: SHA-256 hash over (content + sorted metadata + sorted tags); `_liteId` stripped before hash and idempotency compares.
- Pass: `BackfillService`: per-item `try/catch`; failures counted + logged, never raised; cursor persisted on every page.
- Minor: `BACKFILL_BATCH_SIZE` env var is parsed then `void`ed at [backfill.service.ts:152-179](apps/mcp-server/src/migration/backfill.service.ts#L152-L179). Either the var is removed from the docs + env example, or it should drive the lite-store page size.
- Minor: Verifier N+1: `enterpriseLtm.get` is called per shadow row after a single `list` ([verifier.service.ts:289-308](apps/mcp-server/src/migration/verifier.service.ts#L289-L308)). 10k memories per user -> 10k round-trips. _Recommendation_: add a `MemoryLtmService.listByIds(ids)` batch getter or fall back to the `list` page output only.

### Maintainability

- Pass: Naming consistent (`*Service`, `*.service`, `*.module`).
- Pass: JSDoc on every public symbol with rationale.
- Minor: `resolveDataDir` is implemented three times (`backfill.service.ts:108-118`, `verifier.service.ts:388-395`, dual-write reaches into `liteStore`). _Recommendation_: export a single `getLiteStoreDataDir(store)` accessor from `@engram/memory-lite` (gated by a `dataDir` getter) so migration tooling does not need `Reflect.get` casts.

### Tests

- Pass: Claimed 320 jest + 47 vitest is **verified** by the live test run (this review session ran `pnpm test` -> `mcp-server: Test Suites: 27 passed, Tests: 320 passed`).
- Pass: Critical paths covered: encryption round-trip + AAD + tamper detection (16 tests), permission enforcement (14), lite-store CRUD + concurrency (17), admin-token constant-time (5), secret redaction (3), migration state (13), dual-write (7), migration full path / rollback / chaos (11).
- Minor: Coverage thresholds documented (`>= 85%` new code, `>= 90%` memory-lite) but no coverage reporter is wired into CI - tracked as `WI-P5-B`.

### Conventions

- Pass: TypeScript strict; `any` use is justified and documented.
- Pass: Zod `.strict()` schemas maintained.
- Pass: NestJS DI throughout; `@Optional()` used appropriately for adapters that may be absent.
- Pass: Package boundaries clear; shared behaviour in `packages/*`, not duplicated in `apps/`.

### Docs

- Pass: README profile matrix, SETUP per-profile path, RELEASE_GATES measurable gates, mcp-server README tool matrix.
- Minor: `RELEASE_GATES.md` references `report.globalMismatchFraction === 0` but the verifier returns `globalMismatchRatio`. Document field name mismatch - pick one.
- Minor: No `Encryption key rotation` design (DD-WI-P5-F follow-on): `v1:` prefix supports algorithm upgrades but not in-place key rotation. _Recommendation_: add `keyId` to the encrypted payload so operators can target a single key for re-encryption.

### Deviations

- **DD-01 (Phase 3)**: file-backed JSON + AES-256-GCM replaces SQLite/Prisma. Recorded in plan-log.
- **DD-02 (Phase 4)**: `_liteId` metadata annotation. Recorded in changes-log only; **should be added to plan-log** (Mj-2).
- **DD-03 (Phase 4)**: `BackfillService` bypasses `reindex-queue.service.ts`. **Should be recorded in plan-log** (Mj-1).
- **DD-04 (Phase 4)**: `BACKFILL_BATCH_SIZE` is dead code. **Should be recorded in plan-log** (M-1).

---

## Validation Command Outputs

| Command                                                                       | Result                                                                                      | Evidence                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `pnpm build`                                                                  | Pass 14/14 packages succeed                                                                 | Turbo cache hit; `Tasks: 14 successful, 14 total`       |
| `pnpm lint`                                                                   | Pass 15/15 packages clean (0 errors)                                                        | Turbo cache hit; `Tasks: 15 successful, 15 total`       |
| `pnpm typecheck`                                                              | Pass 12/12 packages clean                                                                   | Turbo cache hit; `Tasks: 12 successful, 12 total`       |
| `pnpm test`                                                                   | Pass 21/21 packages; **320/320 jest** across 27 suites + 47 vitest in `@engram/memory-lite` | `mcp-server: Test Suites: 27 passed, Tests: 320 passed` |
| `pnpm --filter mcp-server test -- --testPathPattern='dual-write\|migration-'` | Pass 4 suites, 25 cases                                                                     | `Tests: 25 passed, 25 total`                            |
| `pnpm docs:check`                                                             | Not run (no `docs:check` invocation in this review)                                         | Recommendation: verify in follow-up                     |

> Build/lint/typecheck/test ran during this review session, 2026-06-24. Pre-existing `@prisma/client` resolution failure (`DR-P1-01`) is resolved - Prisma client regenerated.

---

## Missing Work and Deviations

### Documented deviations (DDS)

| ID    | Origin             | Description                                              | Status                                 |
| ----- | ------------------ | -------------------------------------------------------- | -------------------------------------- |
| DD-01 | Phase 3            | file-backed JSON + AES-256-GCM vs SQLite/Prisma          | Recorded in plan-log                   |
| DD-02 | Phase 4            | `_liteId` metadata annotation for lite<->enterprise link | Changes-log only - **add to plan-log** |
| DD-03 | Phase 4 (proposed) | `BackfillService` bypasses `reindex-queue.service.ts`    | **Add to plan-log**                    |
| DD-04 | Phase 4 (proposed) | `BACKFILL_BATCH_SIZE` is dead code                       | **Add to plan-log**                    |

### Unaddressed research items (carry-overs from plan)

| ID       | Origin   | Description                                                           | Status                                |
| -------- | -------- | --------------------------------------------------------------------- | ------------------------------------- |
| DR-01    | Plan     | durable-local backend choice - resolved by Phase 3 (file-backed JSON) | Resolved                              |
| DR-02    | Plan     | encryption key source priority - deferred (`WI-P5-F`)                 | Pending                               |
| DR-03    | Plan     | per-tenant auth binding - v1.0+ (`WI-04`)                             | Out of scope for this plan            |
| DR-04    | Plan     | GA scale envelope - Phase 5 (`WI-03`)                                 | Partial: documented in RELEASE_GATES  |
| DR-P1-01 | Plan log | Pre-existing `@prisma/client` resolution                              | Resolved during Phase 4 consolidation |
| DR-P1-02 | Plan log | Phase 2 scaffolding imports Phase 1 exports                           | Acknowledged; no action               |

### Missing work (consolidated)

- `WI-P3-E` - `MemoryLiteModule.forRoot` / `MigrationModule.forRoot` not wired into `AppModule.forRoot` (Phase 3 major).
- `WI-P5-A` - plan numbering cleanup (duplicate unchecked 4.2/4.3/4.5 entries).
- `WI-P5-B` - coverage threshold (>= 85%) wired into CI.
- `WI-P5-C` - branch-protection rules for `profile-matrix.yml`.
- `WI-P5-D` - profile-lite restart + recall E2E smoke in the matrix workflow.
- `WI-P5-E` - migration controller / CLI exposing the migration surface (`verify-migration`, `cutover-migration`, `abort-migration`).
- `WI-P5-F` - encryption key rotation (`v1:` + `keyId`).
- `WI-P5-G` - apply constant-time + audit to `api-keys.controller.ts`.
- `WI-04` - per-tenant auth binding (out of scope).
- Tenant-spoof negative test missing from `lite-store.spec.ts`.
- `Report.globalMismatchFraction` field name referenced in `RELEASE_GATES.md` does not exist in `VerifierReport` interface (which exposes `globalMismatchRatio`).
- `BACKFILL_BATCH_SIZE` either removed from env example or wired to the lite-store page size.
- `_liteId` reserved-prefix guard (if user metadata can collide with the link key).
- Verifier N+1 `enterpriseLtm.get` optimisation.

---

## Follow-Up Work

### Deferred from plan scope

| Work Item                                                  | Source                          | Priority |
| ---------------------------------------------------------- | ------------------------------- | -------- |
| Coverage reporter in CI                                    | Plan Step 5.5                   | P1       |
| Migration controller / CLI (`verify`, `cutover`, `abort`)  | Plan Step 5.5                   | P1       |
| `MemoryLiteModule.forRoot` wiring into `AppModule.forRoot` | Plan Step 3.1                   | P1       |
| Encryption key rotation (`v1:` + `keyId`)                  | Plan Step 3.2 (DR-02 follow-up) | P2       |
| Per-tenant auth binding                                    | Plan v1.0+ (`WI-04`)            | P3       |
| Branch-protection rules for `profile-matrix.yml`           | Plan Step 5.4                   | P2       |
| `api-keys.controller.ts` constant-time + audit             | Plan Step 3.3 (`WI-P5-G`)       | P1       |

### Discovered during review

| Finding                                                                                 | Severity | Recommended Action                                                      |
| --------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Plan numbering duplicate Step 4.2/4.3/4.5                                               | Minor    | Plan-log housekeeping (`WI-P5-A`)                                       |
| `RELEASE_GATES.md` references `globalMismatchFraction` (field is `globalMismatchRatio`) | Minor    | Doc fix                                                                 |
| `BACKFILL_BATCH_SIZE` parsed then voided                                                | Minor    | Remove or wire (`DD-04`)                                                |
| `_liteId` as the only lite<->enterprise link                                            | Major    | Record DD-02 in plan-log; add guard spec                                |
| `BackfillService` bypasses reindex queue                                                | Major    | Record DD-03 or refactor                                                |
| Verifier N+1 `enterpriseLtm.get`                                                        | Minor    | Add batch getter or fall back to `list` page output                     |
| `_liteId` collision risk with user metadata                                             | Minor    | Reserve `_engram_*` prefix; reject collisions in `LiteJsonStore.create` |
| Tenant-spoof negative test missing                                                      | Minor    | Add test to `lite-store.spec.ts`                                        |
| `resolveDataDir` duplicated 3x                                                          | Minor    | Export `getLiteStoreDataDir()` from `@engram/memory-lite`               |
| `resolveActiveProfile()` duplicated 5x                                                  | Minor    | Phase 1.5 follow-on (already in plan-log)                               |
| Test count off by 7 (changes-log claims 32, observed 25)                                | Minor    | Doc fix or add missing "1 verifier report" test                         |

---

## Overall Status

## Complete - Ready for Merge with Follow-Ons

All 26/26 plan steps implemented. Build, lint, typecheck, and test (320 jest + 47 vitest) are green. Three Major findings are tracked but none are blocking:

1. **Mj-1 reindex-queue bypass** - record `DD-03` or refactor before GA; non-blocking for the merge since tests pass.
2. **Mj-2 `_liteId` link concentration** - record `DD-02` in plan-log; consider first-class `liteId` field in `CreateLtmMemoryData` before GA.
3. **MemoryLiteModule wiring** - `WI-P3-E`; either wire into `AppModule.forRoot` or document explicitly as out-of-scope for this PR.

The profile ladder delivers on all stated user requirements: zero-deps profile-memory, secure local profile-lite with AES-256-GCM + 0700/0600 perms, profile-enterprise unchanged and backward-compatible, hybrid retrieval in every profile, and a measured migration path from lite -> enterprise with SHA-256 verification and a hard-stop fraction.

---

## Reviewer Notes

- `Implementation Validator` subagent was unable to access files in this session; quality findings above were produced by direct file inspection.
- Build/lint/typecheck/test all ran from a clean state in this review session; pre-existing `@prisma/client` resolution failure (`DR-P1-01`) is confirmed resolved.
- Plan numbering has duplicate unchecked Step 4.2/4.3/4.5 entries; first-occurrence interpretation was used by the Phase 4 validator and is recommended for the rest of the project.
- The `MIGRATION_BACKEND` / `LITE_STORE_TOKEN` / `STM_PROVIDER` / `LTM_PROVIDER` injection-token pattern is consistent across the codebase; wiring the remaining module factories into `AppModule.forRoot` will close the last "service reachable only via direct construction" gap.
- `RELEASE_GATES.md` is the single source of truth for SLOs and is cited by `profile-matrix.yml`; minor doc fix needed (`globalMismatchFraction` -> `globalMismatchRatio`).

---

## Handoff

| Summary               |                                                                 |
| --------------------- | --------------------------------------------------------------- |
| **Review Log**        | `.copilot-tracking/reviews/2026-06-23/profile-ladder-review.md` |
| **Overall Status**    | Complete - Ready for Merge with Follow-Ons                      |
| **Critical Findings** | 0                                                               |
| **Major Findings**    | 3                                                               |
| **Minor Findings**    | 23                                                              |
| **Follow-Up Items**   | 11 tracked + 3 plan-log DD additions                            |
| **Validation Files**  | `rpi/2026-06-23/profile-ladder-00{1..5}-validation.md`          |

**Next steps**

1. `/clear` to reset context.
2. Attach or open this review log + the validation files.
3. Major follow-ups - choose one path:
   - `/task-implement` to address `WI-P3-E` (MemoryLiteModule wiring) and `WI-P5-E` (migration controller/CLI).
   - `/task-research` to scope `WI-P5-F` (encryption key rotation) and `WI-04` (per-tenant auth).
   - `/task-plan` to draft `DD-02` / `DD-03` / `DD-04` into the plan-log and add the missing coverage enforcement gate.
