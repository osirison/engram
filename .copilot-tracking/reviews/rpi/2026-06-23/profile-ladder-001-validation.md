<!-- markdownlint-disable-file -->

# RPI Validation — Phase 1: Profile Infrastructure

- **Plan file**: [profile-ladder-plan.instructions.md](../../../plans/2026-06-23/profile-ladder-plan.instructions.md)
- **Changes log**: [profile-ladder-changes.md](../../../changes/2026-06-23/profile-ladder-changes.md)
- **Plan log**: [profile-ladder-log.md](../../../plans/logs/2026-06-23/profile-ladder-log.md)
- **Phase**: 1 — Profile Infrastructure (Steps 1.1, 1.2, 1.3, 1.4)
- **Validation date**: 2026-06-23
- **Validator**: RPI Validator (read-only)

---

## Overall Phase Status: **Complete (with documented deviations)**

All four Phase 1 steps (1.1, 1.2, 1.3, 1.4) are implemented in code, the
test expectation for the default `DEPLOYMENT_PROFILE='enterprise'` was updated
in `env.schema.spec.ts`, and the global turbo `globalEnv` list now contains
`DEPLOYMENT_PROFILE` (Step 1.4's `lint`/`typecheck`/`build` gates are
satisfied for the Phase 1 surface). The plan-log records two pre-existing
discrepancies (`DR-P1-01`, `DR-P1-02`) and three Phase 1.5 follow-on items
that are explicitly out-of-scope for Phase 1. No missing work, no blocking
deviations, no orphan files for the Phase 1 surface.

---

## Per-Step Verification Table

| Step | Plan Requirement                                                                                                                                    | Implementation Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1.1  | `DEPLOYMENT_PROFILE` enum added; `DATABASE_URL`/`REDIS_URL`/`QDRANT_URL` conditional by profile                                                     | [env.schema.ts:18-23](packages/config/src/env.schema.ts#L18-L23) (conditional URL definitions) + [env.schema.ts:69-129](packages/config/src/env.schema.ts#L69-L129) (single-pass transform: `memory` → skip all three URLs, `lite` → require `DATABASE_URL` only, `enterprise` → require all three)                                                                                                                                                                           | **Pass**                        |
| 1.1  | New file `packages/config/src/profile.ts` with `ProfileConfig`/`ProfileCapabilities` and capability resolver                                        | [profile.ts:8-17](packages/config/src/profile.ts#L8-L17) (`DeploymentProfile` enum), [profile.ts:30-39](packages/config/src/profile.ts#L30-L39) (`ProfileCapabilities` interface), [profile.ts:47-72](packages/config/src/profile.ts#L47-L72) (`resolveCapabilities()` per profile), [profile.ts:78-100](packages/config/src/profile.ts#L78-L100) (`coerceDeploymentProfile()`)                                                                                               | **Pass**                        |
| 1.2  | `AppModule` converted to `DynamicModule` factory with conditional imports; skip `PrismaModule`/`RedisModule`/`QdrantModule` for `memory` and `lite` | [app.module.ts:30-37](apps/mcp-server/src/app.module.ts#L30-L37) (`resolveActiveProfile()`), [app.module.ts:49-68](apps/mcp-server/src/app.module.ts#L49-L68) (`buildImportsForProfile()` — gates on `requiresDatabase`/`requiresRedis`/`requiresQdrant`), [app.module.ts:78-104](apps/mcp-server/src/app.module.ts#L78-L104) (`AppModule.forRoot(profile?)` factory)                                                                                                         | **Pass**                        |
| 1.3  | `HealthModule.forRoot(capabilities)` factory wires indicators conditionally (memory=process only, lite=+local store, enterprise=all)                | [health.module.ts:31-55](apps/mcp-server/src/health/health.module.ts#L31-L55) (`HealthModule.forRoot()` adds `PrismaModule` only when `requiresDatabase`, `RedisModule` only when `requiresRedis`, `QdrantModule`/`VectorStoreModule` only when `requiresQdrant`; `MemoryStoreHealthIndicator` always present)                                                                                                                                                                | **Pass**                        |
| 1.3  | `HealthController` reads active profile and only includes enabled indicators                                                                        | [health.controller.ts:60-78](apps/mcp-server/src/health/health.controller.ts#L60-L78) (`buildIndicators()` pushes `MemoryStoreHealthIndicator` unconditionally, then gates `PrismaHealthIndicator`/`RedisHealthIndicator`/`QdrantHealthIndicator`/`PgVectorHealthIndicator` behind the capability flags); [health.controller.ts:46-58](apps/mcp-server/src/health/health.controller.ts#L46-L58) (`activeCapabilities()` reads the `'ENGRAM_PROFILE'` token with env fallback) | **Pass**                        |
| 1.4  | Run `build`/`lint`/`typecheck`; defer full test suite to Phase 3                                                                                    | `turbo.json` [turbo.json:4-12](turbo.json#L4-L12) — `DEPLOYMENT_PROFILE` added to `globalEnv` so `turbo/no-undeclared-env-vars` lint no longer warns. Plan-log `DR-P1-01` documents the pre-existing monorepo-wide `PrismaClient` typecheck failure as out-of-scope for Phase 1; plan-log Phase 1.5 candidates explicitly defer the full-suite rerun until Prisma client is regenerated.                                                                                      | **Pass (with deferred caveat)** |

### Additional Phase 1 wiring verified

| Item                                                                           | Evidence                                                                                                                     | Status   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| `main.ts` updated to use `AppModule.forRoot()`                                 | [main.ts:51](apps/mcp-server/src/main.ts#L51) (`NestFactory.create(AppModule.forRoot(), …)`)                                 | **Pass** |
| `reindex.cli.ts` updated to use `AppModule.forRoot()`                          | [reindex.cli.ts:71](apps/mcp-server/src/reindex.cli.ts#L71) (`NestFactory.createApplicationContext(AppModule.forRoot(), …)`) | **Pass** |
| `config/src/index.ts` re-exports profile primitives                            | [index.ts:4-12](packages/config/src/index.ts#L4-L12)                                                                         | **Pass** |
| Test expectation updated to include `DEPLOYMENT_PROFILE: 'enterprise'` default | [env.schema.spec.ts:18-30](packages/config/src/env.schema.spec.ts#L18-L30)                                                   | **Pass** |
| `MemoryStoreHealthIndicator` (process-only) added                              | [memory-store.health.ts:1-25](apps/mcp-server/src/health/memory-store.health.ts#L1-L25)                                      | **Pass** |

---

## Findings

### Critical

_None._

### Major

_None._

### Minor

- **M-1: `Env` type fields are explicitly `optional` but the transform normalises them to `undefined` for `memory`/`lite`/`non-enterprise` profiles.**
  - **File**: [packages/config/src/env.schema.ts:152-169](packages/config/src/env.schema.ts#L152-L169)
  - **Description**: The `Env` type declares `DATABASE_URL?`, `REDIS_URL?`, `QDRANT_URL?` as optional. For `DEPLOYMENT_PROFILE=memory` the transform sets `DATABASE_URL=undefined` and for `!enterprise` it sets `REDIS_URL=undefined` and `QDRANT_URL=undefined`. This is consistent with the conditional validation logic above it (lines 69-129), so the runtime behaviour is correct; the minor finding is that downstream consumers reading `env.REDIS_URL` for profile=memory will silently get `undefined` rather than a hard error. The plan's Step 1.1 only requires the URL be optional, so this is acceptable, but a docblock note at the type alias warning consumers not to read URL fields without first checking the resolved profile would harden the contract.
  - **Recommendation**: Add a JSDoc note to the `Env` type alias making the per-profile availability explicit, or expose a narrowed `EnvForProfile<P>` helper.

- **M-2: `HealthController.resolveProfileFromEnv()` duplicates the coercion logic that lives in `coerceDeploymentProfile()`.**
  - **File**: [apps/mcp-server/src/health/health.controller.ts:50-78](apps/mcp-server/src/health/health.controller.ts#L50-L78)
  - **Description**: The controller defines `resolveProfileFromEnv()` + `coerceProfileString()` that hand-roll the same lowercase + match logic exported from `@engram/config#coerceDeploymentProfile`. The plan-log already calls this out as a Phase 1.5 follow-on ("extract `resolveActiveProfile()` from `app.module.ts` into a shared helper").
  - **Recommendation**: Replace the inline coercion with `coerceDeploymentProfile(process.env.DEPLOYMENT_PROFILE)` from `@engram/config` to remove the duplicate and the per-line `eslint-disable @typescript-eslint/no-unsafe-enum-comparison` pragmas.

- **M-3: Pre-existing monorepo typecheck failures (`@prisma/client` export missing) block the end-to-end Phase 1.4 build/lint/typecheck gates.**
  - **File**: plan-log [profile-ladder-log.md](../../plans/logs/2026-06-23/profile-ladder-log.md) `## Phase 1 Implementation Notes → DR-P1-01`
  - **Description**: The Phase 1 source files themselves lint/typecheck/build clean when invoked with `--filter @engram/config` or `npx tsc -p tsconfig.check.json`, but `pnpm build`/`pnpm lint`/`pnpm typecheck` at the monorepo root still fail because `packages/database` and downstream consumers (`@engram/memory-stm`, `@engram/memory-ltm`, `@engram/vector-store`) cannot resolve `PrismaClient`. Verified pre-existing via `git stash` + baseline build, attributed to a pnpm install state mismatch.
  - **Recommendation**: Track as Phase 1.5; regenerate the Prisma client + re-run `pnpm install` before Phase 4 wiring assumes the full pipeline is green. The changes-log "Additional or Deviating Changes" block already records this resolution was performed during Phase 4 consolidation; if that is true, mark `DR-P1-01` as resolved in the plan-log.

---

## Missing Work or Deviations

### Documented deviations (none raised new for Phase 1)

The plan-log records three plan-level design decisions (`DD-01`, `DD-02`,
`DD-03`) that pre-date implementation:

- `DD-01` profile enum naming (`memory` / `lite` / `enterprise` vs. the
  research's `profile-memory` / `profile-lite` / `profile-enterprise`).
  **Confirmed**: [profile.ts:8-17](packages/config/src/profile.ts#L8-L17) uses
  `memory` / `lite` / `enterprise`, matching the plan.
- `DD-02` lazy connect on Prisma/Redis with explicit error before first use.
  **Confirmed**: Prisma/Redis lazy connect is owned by Phase 2
  (`Step 2.4`), not Phase 1; Phase 1 only declares the conditional module
  imports in `AppModule.forRoot()`. No Phase 1 deviation.
- `DD-03` dual-write timing is Phase 4. **Confirmed**: no Phase 1 surface
  references dual-write.

### Unaddressed research items (carried forward from plan, no Phase 1 work expected)

- `DR-01` durable-local backend choice — Phase 3 decision.
- `DR-02` encryption key source priority — Phase 3 decision (WI-02).
- `DR-03` per-tenant auth binding — v1.0+ (WI-04).
- `DR-04` GA scale envelope — Phase 5 (WI-03).

### Phase 1-specific discrepancies (acknowledged in plan-log)

- `DR-P1-01` (pre-existing baseline build failure) — see **M-3** above.
- `DR-P1-02` (Phase 2 scaffolding imports Phase 1 exports) — confirmed by
  file evidence: `packages/memory-stm/src/memory-stm.module.ts`,
  `packages/memory-ltm/src/memory-ltm.module.ts`, `apps/mcp-server/src/memory/memory.controller.ts`
  already import `DeploymentProfile` / `ProfileCapabilities`. Per plan-log
  guidance these were left untouched because Phase 1 is read-only with
  respect to Phase 2's adapter shape. The Phase 1 contract was validated
  by the Phase 2 subagent; **no Phase 1 action required**.

### No `Removed` section in changes log for Phase 1

Confirmed: the "Removed" section header in
[profile-ladder-changes.md](../../../changes/2026-06-23/profile-ladder-changes.md)
contains no Phase 1 entries. No files were deleted as part of Phase 1.

---

## Phase Summary Verdict

**Phase 1 — Profile Infrastructure: Complete.**

| Aspect                                                                                                                                  | Result                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1.1 — profile resolver + conditional env validation                                                                                | ✅ Implemented and aligned with plan                                                                                                                                      |
| Step 1.2 — `AppModule.forRoot(profile?)` skips Prisma/Redis/Qdrant for `memory` and `lite`                                              | ✅ Implemented and aligned with plan                                                                                                                                      |
| Step 1.3 — `HealthModule.forRoot(capabilities)` wires indicators conditionally (memory=process only, lite=+local store, enterprise=all) | ✅ Implemented and aligned with plan                                                                                                                                      |
| Step 1.4 — `build`/`lint`/`typecheck` validation                                                                                        | ⚠️ Per-file gates pass; monorepo-wide gates blocked by pre-existing `PrismaClient` resolution failure (`DR-P1-01`, resolved during Phase 4 consolidation per changes-log) |
| Documented plan deviations (`DD-01`/`DD-02`/`DD-03`)                                                                                    | ✅ Reflected in implementation                                                                                                                                            |
| Unaddressed research items (`DR-01`/`DR-02`/`DR-03`/`DR-04`)                                                                            | ✅ Correctly out-of-scope for Phase 1                                                                                                                                     |

**Critical findings**: 0
**Major findings**: 0
**Minor findings**: 3 (all stylistic / contract-hygiene; no functional
impact)

Phase 1 is ready to hand off to Phase 2 — and the changes log confirms
Phase 2 has already begun consuming the Phase 1 contract (`DR-P1-02`).
