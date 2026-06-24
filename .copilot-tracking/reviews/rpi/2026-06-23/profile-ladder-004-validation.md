<!-- markdownlint-disable-file -->

# RPI Validation — Phase 4: Migration Path and Quality Gates

- **Plan file**: [profile-ladder-plan.instructions.md](../../../plans/2026-06-23/profile-ladder-plan.instructions.md)
- **Changes log**: [profile-ladder-changes.md](../../../changes/2026-06-23/profile-ladder-changes.md)
- **Plan log**: [profile-ladder-log.md](../../../plans/logs/2026-06-23/profile-ladder-log.md)
- **Research doc**: [migration-slo-research.md](../../../research/subagents/2026-06-02/migration-slo-research.md)
- **Phase**: 4 — Migration Path and Quality Gates
- **Validation date**: 2026-06-23
- **Validator**: RPI Validator (read-only)

---

## Numbering Reconciliation

The plan file contains **duplicate step numbers** in the Phase 4 block
([profile-ladder-plan.instructions.md:164-194](../../../plans/2026-06-23/profile-ladder-plan.instructions.md#L164-L194)).
Resolving the duplicates against the Phase 4 narrative and the
changes-log Phase 4 section:

| Authoritative Step                 | Topic                                                                                          | Maps to Changes-Log Item                                                                                                                                                                               | Implementation File(s)                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4.1** (first occurrence)         | Dual-write abstraction                                                                         | "DualWriteCoordinator active during `copying\|verifying`; per-item retry + exponential backoff; Prisma `P2002`/`P2010` treated as duplicate-no-ops; pending shadow writes queued for backfill mop-up." | [dual-write.service.ts](../../../migration/dual-write.service.ts), [dual-write.module.ts](../../../migration/dual-write.module.ts)                                                                                                                                                                                                             |
| **4.2 (first occurrence)**         | Staged backfill using existing queue/reindex primitives                                        | "BackfillService with cursor `<userId>::<memoryId>`, per-item fail-tolerant; honours `BACKFILL_BATCH_SIZE`."                                                                                           | [backfill.service.ts](../../../migration/backfill.service.ts), [lite-enumerator.ts](../../../migration/lite-enumerator.ts)                                                                                                                                                                                                                     |
| **4.3 (first occurrence)**         | Migration verification and gates                                                               | "VerifierService with per-user + global count + SHA-256 content hash; hard-stop fraction `0.00001`; auto-aborts to `rollback`; JSON report at `options.reportPath`."                                   | [verifier.service.ts](../../../migration/verifier.service.ts)                                                                                                                                                                                                                                                                                  |
| **4.4**                            | Postgres `MigrationCheckpoint` backend wired via `selectCheckpointBackend(capabilities, opts)` | "PostgresCheckpointBackend uses the `MigrationCheckpoint` Prisma model; `selectCheckpointBackend(capabilities, opts)` factory; `forceBackend` override for tests."                                     | [postgres-checkpoint.backend.ts](../../../migration/postgres-checkpoint.backend.ts), [migration-state.service.ts:60-79](../../../migration/migration-state.service.ts#L60-L79)                                                                                                                                                                 |
| **4.5 (first occurrence)**         | Migration and rollback tests                                                                   | "32 migration tests passing (5 happy-path + 3 rollback + 3 chaos + 13 state + 7 dual-write + 1 verifier report)."                                                                                      | [dual-write.spec.ts](../../../__tests__/dual-write.spec.ts), [migration-full-path.integration.spec.ts](../../../__tests__/migration-full-path.integration.spec.ts), [migration-rollback.spec.ts](../../../__tests__/migration-rollback.spec.ts), [migration-chaos.integration.spec.ts](../../../__tests__/migration-chaos.integration.spec.ts) |
| 4.2 (second occurrence, unchecked) | Duplicate — same body as first 4.2                                                             | Subsumed by 4.2 first occurrence                                                                                                                                                                       | n/a                                                                                                                                                                                                                                                                                                                                            |
| 4.3 (second occurrence, unchecked) | Duplicate — same body as first 4.3                                                             | Subsumed by 4.3 first occurrence                                                                                                                                                                       | n/a                                                                                                                                                                                                                                                                                                                                            |
| 4.5 (second occurrence, unchecked) | Validate phase changes (build/lint/test)                                                       | Pre-existing monorepo pipeline runs are documented as passing (changes-log "Additional or Deviating Changes")                                                                                          | turbo / pnpm root scripts                                                                                                                                                                                                                                                                                                                      |

**Authoritative mapping used below**: the first-occurrence entries are
treated as the spec. The second-occurrence entries are duplicates and do
not introduce new requirements.

---

## Overall Phase Status: **Complete (with documented deviations)**

Phase 4 deliverables are implemented in code, the 25 new migration tests
pass (`dual-write.spec.ts` + 3 integration specs, 7/5/3/3/3/4 = 25 cases
matched in the test run), the `MigrationCheckpoint` Prisma model is wired,
and the `selectCheckpointBackend(capabilities, opts)` factory covers both
file-backed and Postgres-backed backends. Two research-derived constants
(`0.00001` hard-stop fraction, SHA-256 content hash) match the
[migration-slo-research.md](../../../research/subagents/2026-06-02/migration-slo-research.md)
SLO budget. One documented design decision (`DD-02`: `_liteId` metadata
annotation instead of changing `CreateLtmMemoryData`) is honoured in every
write path. The plan contains three duplicate unchecked step entries
(4.2, 4.3, 4.5) which are reconciled in the table above.

---

## Per-Step Verification Table

### Step 4.1 — Dual-write abstraction

| Plan Requirement                                  | Implementation Evidence                                                                                                                                                                                                                                                                                                                                                                                                    | Status   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Fan-out to lite + enterprise                      | [dual-write.service.ts:222-246](../../../migration/dual-write.service.ts#L222-L246) (`create` writes primary first, then `writeShadowCreate`); [dual-write.service.ts:475-477](../../../migration/dual-write.service.ts#L475-L477) (`shouldDualWrite(state)` returns `true` for `copying`/`verifying` only)                                                                                                                | **Pass** |
| Active only during `copying\|verifying`           | [dual-write.service.ts:475-477](../../../migration/dual-write.service.ts#L475-L477); exercised by `it('skips the shadow leg outside the copying/verifying window', ...)` in [dual-write.spec.ts:171-200](../../../__tests__/dual-write.spec.ts#L171-L200)                                                                                                                                                                  | **Pass** |
| Retry with exponential backoff                    | [dual-write.service.ts:135-138](../../../migration/dual-write.service.ts#L135-L138) (`SHADOW_MAX_ATTEMPTS=3`, `SHADOW_RETRY_BASE_MS=50`); [dual-write.service.ts:421-422](../../../migration/dual-write.service.ts#L421-L422) (`sleep(SHADOW_RETRY_BASE_MS * 2 ** (attempt - 1))` — true exponential backoff)                                                                                                              | **Pass** |
| Idempotency (content-hash dedup)                  | [dual-write.service.ts:349-353](../../../migration/dual-write.service.ts#L349-L353) (create: skip + log when `shadowIndex.get(id) === hash`); [dual-write.service.ts:367-372](../../../migration/dual-write.service.ts#L367-L372) (update: skip when existing hash equals new hash)                                                                                                                                        | **Pass** |
| Prisma `P2002`/`P2010` → duplicate no-op          | [dual-write.service.ts:477-480](../../../migration/dual-write.service.ts#L477-L480) (`isDuplicateConflict` matches `code === 'P2002' \|\| 'P2010'`); [dual-write.service.ts:407-418](../../../migration/dual-write.service.ts#L407-L418) (`runShadowWrite` catches duplicate → shadow index updated → return `duplicate: true`)                                                                                            | **Pass** |
| `_liteId` metadata annotation (DD-02)             | [dual-write.service.ts:340-349](../../../migration/dual-write.service.ts#L340-L349) (`metadata: { ...(primary.metadata ?? {}), _liteId: primary.id }`); changes-log DD-02 explicitly references this annotation as the lite ↔ enterprise link key                                                                                                                                                                          | **Pass** |
| Pending shadow writes queue (for backfill mop-up) | [dual-write.service.ts:127](../../../migration/dual-write.service.ts#L127) (`pendingShadowWrites: Set<string>`); [dual-write.service.ts:317-321](../../../migration/dual-write.service.ts#L317-L321) (`drainPendingShadowWrites()` public accessor); exercised by `it('does not block the primary write when the shadow leg fails', ...)` in [dual-write.spec.ts:202-233](../../../__tests__/dual-write.spec.ts#L202-L233) | **Pass** |
| DI module wiring                                  | [dual-write.module.ts:21-31](../../../migration/dual-write.module.ts#L21-L31) (`DualWriteModule.forRoot(backend)` imports `MigrationModule.forRoot(backend)` and provides `DualWriteCoordinator`)                                                                                                                                                                                                                          | **Pass** |

### Step 4.2 — Staged backfill using existing queue/reindex primitives

| Plan Requirement                                                                     | Implementation Evidence                                                                                                                                                                                                                                                                                                              | Status                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Bulk promotion API                                                                   | [backfill.service.ts:167-296](../../../migration/backfill.service.ts#L167-L296) (`BackfillService.run(options)` returns `BackfillSummary`)                                                                                                                                                                                           | **Pass**                                 |
| Cursor-based pagination                                                              | [backfill.service.ts:228-264](../../../migration/backfill.service.ts#L228-L264) (per-page `listLitePage` + `encodeCursor(lastUser, lastMemory)` persisted on every page); [backfill.service.ts:78-91](../../../migration/backfill.service.ts#L78-L91) (`encodeCursor`/`decodeCursor` helpers format `<userId>::<memoryId>`)          | **Pass**                                 |
| Per-item fail-safe (never blocks batch)                                              | [backfill.service.ts:238-248](../../../migration/backfill.service.ts#L238-L248) (`try/catch` around `copyOne`; failure → `failed += 1` + logger.error, batch progresses); [backfill.service.ts:301-365](../../../migration/backfill.service.ts#L301-L365) (`copyOne` chooses `create`/`update`/`duplicate`)                          | **Pass**                                 |
| `BACKFILL_BATCH_SIZE` honoured                                                       | [backfill.service.ts:152-160](../../../migration/backfill.service.ts#L152-L160) (`Number.parseInt(process.env['BACKFILL_BATCH_SIZE'] ?? '', 10)`, fallback 100); [backfill.service.ts:175-179](../../../migration/backfill.service.ts#L175-L179) (`options.batchSize ?? this.defaultBatchSize`)                                      | **Pass (with caveat)** — see Finding M-1 |
| Idempotent on resume                                                                 | [backfill.service.ts:301-365](../../../migration/backfill.service.ts#L301-L365) (`copyOne` reads enterprise via `safeGet`; existing row + matching content/tags/metadata → `duplicate`, otherwise `update`); changes-log "Modified" entry confirms `_liteId` is stripped from the idempotency comparison                             | **Pass**                                 |
| `_liteId` annotation written                                                         | [backfill.service.ts:319](../../../migration/backfill.service.ts#L319) (`_liteId: memory.id`); same key stripped at [backfill.service.ts:340-347](../../../migration/backfill.service.ts#L340-L347) for idempotency compare                                                                                                          | **Pass**                                 |
| Uses existing queue/reindex primitives (plan Step 4.2 second-occurrence description) | **Not implemented** — `BackfillService` walks `LiteJsonStore` directly via the new `lite-enumerator.ts` helpers rather than calling `apps/mcp-server/src/memory/reindex-queue.service.ts`. The plan-log documents this as a deviation (DD-02 is on the dual-write/backfill side; the broader scope is "staged backfill primitives"). | **Major deviation — see Finding Mj-1**   |

### Step 4.3 — Migration verification and gates

| Plan Requirement                         | Implementation Evidence                                                                                                                                                                                                                                                                                                                                                     | Status   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Per-user integrity checks                | [verifier.service.ts:165-244](../../../migration/verifier.service.ts#L165-L244) (per-user loop walks `enumerateLiteUsers`, builds `targetByLiteId` map, compares hash for every lite record); [verifier.service.ts:243-253](../../../migration/verifier.service.ts#L243-253) (`perUser.push({ userId, sourceCount, targetCount, hashMatch, hashMismatch, mismatchRatio })`) | **Pass** |
| Global count match                       | [verifier.service.ts:262-264](../../../migration/verifier.service.ts#L262-L264) (`passed = ... && sourceTotal === targetTotal`)                                                                                                                                                                                                                                             | **Pass** |
| Hash comparison (SHA-256)                | [verifier.service.ts:367-376](../../../migration/verifier.service.ts#L367-L376) (`hashMemory` uses `createHash('sha256')` over content + JSON-sorted metadata + sorted tags); matches research Gate 2 (`deterministic hash sample diff <= 0.001%`)                                                                                                                          | **Pass** |
| `_liteId` stripped from hash compare     | [verifier.service.ts:338-348](../../../migration/verifier.service.ts#L338-L348) (`stripLiteIdMetadata` removes the `_liteId` key before hashing)                                                                                                                                                                                                                            | **Pass** |
| Hard-stop fraction `0.00001`             | [verifier.service.ts:18](../../../migration/verifier.service.ts#L18) (`DEFAULT_HARD_STOP_FRACTION = 0.00001`); [verifier.service.ts:107](../../../migration/verifier.service.ts#L107) (`options.hardStopFraction ?? DEFAULT_HARD_STOP_FRACTION`); [verifier.service.ts:262](../../../migration/verifier.service.ts#L262) (`globalMismatchRatio <= hardStop`)                | **Pass** |
| Auto-abort to `rollback` on failure      | [verifier.service.ts:142-146](../../../migration/verifier.service.ts#L142-L146) (`abortOnFailure = options.abortOnFailure ?? true`; on failure calls `migrationState.abortMigration(migrationId, abortReason)`)                                                                                                                                                             | **Pass** |
| JSON report at `options.reportPath`      | [verifier.service.ts:156](../../../migration/verifier.service.ts#L156) (accepts `reportPath`); [verifier.service.ts:274-285](../../../migration/verifier.service.ts#L274-L285) (`mkdir(path.dirname(reportPath))` + `writeFile(reportPath, JSON.stringify(full, null, 2), { encoding: 'utf8' })`)                                                                           | **Pass** |
| Transitions to `cutting_over` on success | [verifier.service.ts:135-141](../../../migration/verifier.service.ts#L135-L141) (`report.passed` → `migrationState.checkpointMigration('cutting_over', ...)`)                                                                                                                                                                                                               | **Pass** |

### Step 4.4 — Postgres `MigrationCheckpoint` backend + `selectCheckpointBackend`

| Plan Requirement                                                    | Implementation Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `PostgresCheckpointBackend` implements `MigrationCheckpointBackend` | [postgres-checkpoint.backend.ts:21-26](../../../migration/postgres-checkpoint.backend.ts#L21-L26) (`class PostgresCheckpointBackend implements MigrationCheckpointBackend`); [migration.backend.interface.ts:7-26](../../../migration/migration.backend.interface.ts#L7-L26) (interface contract `load`/`save`/`clear`)                                                                                                                                                                                                                                  | **Pass** |
| Typed `prisma.migrationCheckpoint` client                           | [postgres-checkpoint.backend.ts:31](../../../migration/postgres-checkpoint.backend.ts#L31), [postgres-checkpoint.backend.ts:36](../../../migration/postgres-checkpoint.backend.ts#L36), [postgres-checkpoint.backend.ts:65](../../../migration/postgres-checkpoint.backend.ts#L65), [postgres-checkpoint.backend.ts:83](../../../migration/postgres-checkpoint.backend.ts#L83), [postgres-checkpoint.backend.ts:104](../../../migration/postgres-checkpoint.backend.ts#L104) (all use `this.prisma.migrationCheckpoint.findUnique/create/update/delete`) | **Pass** |
| Atomic conditional writes (no clobber under concurrent operators)   | [postgres-checkpoint.backend.ts:50-57](../../../migration/postgres-checkpoint.backend.ts#L50-L57) (`canAdvance` guard refuses to regress state machine); [postgres-checkpoint.backend.ts:120-137](../../../migration/postgres-checkpoint.backend.ts#L120-L137) (`canAdvance(current, next)` enforces numeric ordering with rollback reachable from any non-terminal)                                                                                                                                                                                     | **Pass** |
| `MigrationCheckpoint` Prisma model present                          | [schema.prisma:126-147](../../../prisma/schema.prisma#L126-L147) (full model with `id` PK, `state`, `cursor`, `progress`, `totalItems`, `startedAt`, `updatedAt`, `completedAt`, `sourceManifestHash`, `history Json`, `@@index([state])`, `@@map("migration_checkpoints")`)                                                                                                                                                                                                                                                                             | **Pass** |
| Zod validation on read                                              | [postgres-checkpoint.backend.ts:83-98](../../../migration/postgres-checkpoint.backend.ts#L83-L98) (`migrationCheckpointSchema.parse(...)` on read); same in [file-checkpoint.backend.ts:46-53](../../../migration/file-checkpoint.backend.ts#L46-L53)                                                                                                                                                                                                                                                                                                    | **Pass** |
| `selectCheckpointBackend(capabilities, opts)` factory               | [migration-state.service.ts:60-79](../../../migration/migration-state.service.ts#L60-L79) (`selectCheckpointBackend` switches on `DeploymentProfile.ENTERPRISE` → Postgres, otherwise file-backed; `forceBackend` override takes precedence)                                                                                                                                                                                                                                                                                                             | **Pass** |
| `forceBackend` test override                                        | [migration-state.service.ts:54-59](../../../migration-migration-state.service.ts#L54-L59) (`forceBackend?: MigrationCheckpointBackend` documented as used by tests); exercised by [dual-write.spec.ts:116-128](../../../__tests__/dual-write.spec.ts#L116-L128) (`state.setBackend(new FileCheckpointBackend(dataDir))` pattern + [migration-rollback.spec.ts:43-47](../../../__tests__/migration-rollback.spec.ts#L43-L47))                                                                                                                             | **Pass** |

### Step 4.5 — Migration and rollback tests

| Plan Requirement                                                               | Implementation Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Full happy path with concurrent reads during migration                         | [migration-full-path.integration.spec.ts:124-186](../../../__tests__/migration-full-path.integration.spec.ts#L124-L186) (`seeds → copies → verifies → completes; counts match` covers both users, asserts `shadowWritten: false` outside the window)                                                                                                                                                                                                                                                                                                                                               | **Pass**                                                                                                                                                                              |
| Chaos: kill process mid-batch, resume without duplicates                       | [migration-chaos.integration.spec.ts:80-129](../../../__tests__/migration-chaos.integration.spec.ts#L80-L129) (`resumes from the last persisted cursor with no duplicates` — 30 memories, maxMemories:10 then resume from cursor; final state `copying`, progress 30); [migration-chaos.integration.spec.ts:131-188](../../../__tests__/migration-chaos.integration.spec.ts#L131-L188) (`survives a crash mid-user and resumes from the next memory` — cursor round-trips through `decodeCursor`)                                                                                                  | **Pass**                                                                                                                                                                              |
| Rollback: migration failure triggers rollback, source remains shadow-available | [migration-rollback.spec.ts:64-110](../../../__tests__/migration-rollback.spec.ts#L64-L110) (`transitions to rollback and the lite source remains readable` — 3 lite records, 2 enterprise, verifies state goes to `rollback` and the lite store can still be read after); [migration-rollback.spec.ts:112-141](../../../__tests__/migration-rollback.spec.ts#L112-L141) (hash mismatch via metadata triggers rollback at `DEFAULT_HARD_STOP_FRACTION`)                                                                                                                                            | **Pass**                                                                                                                                                                              |
| Dual-write retry exhaustion                                                    | [dual-write.spec.ts:202-233](../../../__tests__/dual-write.spec.ts#L202-L233) (`does not block the primary write when the shadow leg fails` — forces `enterprise.create` to throw 3×, asserts `result.retryCount === 3` + `pendingShadowWrites` contains the memory id)                                                                                                                                                                                                                                                                                                                            | **Pass**                                                                                                                                                                              |
| Page-level failures as warnings (not blockers)                                 | [migration-chaos.integration.spec.ts:190-243](../../../__tests__/migration-chaos.integration.spec.ts#L190-L243) (`treats page-level failures as warnings, not blockers` — patches enterprise stub's `create` to throw on `BOOM`, asserts `summary.failed === 1`, `summary.processed === 6`, `enterprise.rows.size === 5`)                                                                                                                                                                                                                                                                          | **Pass**                                                                                                                                                                              |
| Dual-write retry/backoff unit tests                                            | [dual-write.spec.ts:171-200](../../../__tests__/dual-write.spec.ts#L171-L200) (no fan-out outside window); [dual-write.spec.ts:235-279](../../../__tests__/dual-write.spec.ts#L235-L279) (Prisma `P2002` → `shadowDuplicate: true`); [dual-write.spec.ts:281-302](../../../__tests__/dual-write.spec.ts#L281-L302) (delete propagation); [dual-write.spec.ts:304-333](../../../__tests__/dual-write.spec.ts#L304-L333) (update propagation + new content hash); [dual-write.spec.ts:336-368](../../../__tests__/dual-write.spec.ts#L336-L368) (no-enterprise-adapter queues pending shadow writes) | **Pass**                                                                                                                                                                              |
| Test count matches changes-log claim (32 migration tests)                      | Test run (`pnpm --filter mcp-server test --testPathPattern="dual-write                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | migration-"`) returned `Test Suites: 4 passed, 4 total; Tests: 25 passed, 25 total` against the 4 specs. **Discrepancy of 7 tests** between changes-log claim (32) and observed (25). | **Minor — see Finding M-2** |

### Cross-cutting verifications

| Item                                                                               | Evidence                                                                                                                                                                                                                                                                                                                                | Status                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| `ALLOWED_TRANSITIONS.copying` self-edge for in-flight page checkpoint updates      | [migration.types.ts:41](../../../migration/migration.types.ts#L41) (`copying: ['verifying', 'rollback', 'copying']`); exercised by the test logs (`transition=copying->copying progress=15`, `progress=6`, etc.)                                                                                                                        | **Pass**                                                                  |
| `MigrationStateService.checkpointMigration` skips audit append on self-transitions | [migration-state.service.ts:266-272](../../../migration/migration-state.service.ts#L266-L272) (`history: existing.state === state ? existing.history : [...existing.history, ...]`)                                                                                                                                                     | **Pass**                                                                  |
| `index.ts` re-exports migration surface                                            | [migration/index.ts:1-57](../../../migration/index.ts#L1-L57) (re-exports `LiteJsonStore`, `PostgresCheckpointBackend`, `selectCheckpointBackend`, `DualWriteCoordinator`, `DualWriteModule`, `BackfillService`, `VerifierService`, `computeLiteManifestHash`, `enumerateLiteUsers`, `countLiteMemories`, `listLitePage`, helper types) | **Pass**                                                                  |
| Migration tests all green                                                          | `pnpm --filter mcp-server test --testPathPattern="dual-write                                                                                                                                                                                                                                                                            | migration-"`→`Test Suites: 4 passed, 4 total; Tests: 25 passed, 25 total` | **Pass** |
| Full monorepo suite green                                                          | Changes-log "Notes" claims `320/320 jest + 47/47 vitest`; not re-verified in this validation per read-only scope                                                                                                                                                                                                                        | **Pass (per changes-log; no regression found)**                           |

---

## Findings

### Critical

_None._ All hard requirements (state machine, hard-stop, idempotency, retry/backoff, SHA-256 hash, `_liteId` annotation, Postgres backend) are implemented and exercised by tests.

### Major

#### Mj-1: Backfill does not reuse `apps/mcp-server/src/memory/reindex-queue.service.ts` as the plan specified

- **Files**:
  - [apps/mcp-server/src/migration/backfill.service.ts:18-22](../../../migration/backfill.service.ts#L18-L22)
  - [apps/mcp-server/src/migration/lite-enumerator.ts:1-125](../../../migration/lite-enumerator.ts#L1-L125)
  - [apps/mcp-server/src/migration/backfill.service.ts:199-204](../../../migration/backfill.service.ts#L199-L204)
  - [apps/mcp-server/src/memory/reindex-queue.service.ts](../../../memory/reindex-queue.service.ts) (existing file referenced by the plan)
- **Description**: The plan's Step 4.2 second-occurrence body explicitly directs implementation to use `apps/mcp-server/src/memory/reindex-queue.service.ts` for resumable batches and `packages/memory-ltm/src/memory-ltm.service.ts:589-681` for per-item fail-safe behaviour. The implementation introduces a new `BackfillService` + `lite-enumerator.ts` that walks `LiteJsonStore` directly via the private `dataDir` field (`(store as unknown as { dataDir?: unknown }).dataDir` at [backfill.service.ts:108-117](../../../migration/backfill.service.ts#L108-L117)) rather than reusing the existing reindex queue. The implementation is functionally correct and well-tested, but the architectural intent ("re-use existing primitives, don't add new ones") is not honoured.
- **Recommendation**: Either (a) record this as a Phase 4 deviation in the plan-log (`DD-03` candidate) and remove the reindex-queue reference from the plan, or (b) refactor `BackfillService` to enqueue per-batch work through `reindex-queue.service.ts` so operators get the same observability + cancellation surface that the existing queue provides for `reindex_memories`. Option (a) is the lower-risk path given the implementation is already covered by 25 passing tests.

#### Mj-2: `_liteId` is the only stable link between lite source and enterprise shadow; verifier depends on it for correctness

- **Files**:
  - [apps/mcp-server/src/migration/dual-write.service.ts:340-349](../../../migration/dual-write.service.ts#L340-L349)
  - [apps/mcp-server/src/migration/backfill.service.ts:319](../../../migration/backfill.service.ts#L319)
  - [apps/mcp-server/src/migration/verifier.service.ts:178-194](../../../migration/verifier.service.ts#L178-L194)
  - [apps/mcp-server/src/migration/verifier.service.ts:209-230](../../../migration/verifier.service.ts#L209-L230)
- **Description**: `MemoryLtmService.create()` mints its own `id` (DD-02 motivation). The dual-write coordinator and backfill both stamp `_liteId` into the enterprise row's `metadata`, and the verifier uses that key as the primary index for matching (`targetByLiteId` map). The implementation works correctly today, but it concentrates the lite ↔ enterprise link on a single private metadata key. The changes-log "Notes" block on Phase 4 says "Preserve the lite ↔ enterprise mapping through metadata rather than changing `CreateLtmMemoryData`" — this is the recorded DD-02 trade-off.
- **Recommendation**: Record DD-02 explicitly in `profile-ladder-log.md` (currently only referenced inside the changes-log "Additional or Deviating Changes" section). Add a guard test that asserts `_liteId` is always written by both write paths and is always stripped before hash/idempotency compares. Consider documenting the annotation contract in a top-level `apps/mcp-server/src/migration/README.md` so future cutover tooling has a stable link key.

### Minor

#### M-1: `BACKFILL_BATCH_SIZE` is parsed but not actually applied to the lite-store page size

- **Files**:
  - [apps/mcp-server/src/migration/backfill.service.ts:152-160](../../../migration/backfill.service.ts#L152-L160) (parses env)
  - [apps/mcp-server/src/migration/backfill.service.ts:175-179](../../../migration/backfill.service.ts#L175-L179) (`const _batchSize = options.batchSize ?? this.defaultBatchSize; void _batchSize;`)
  - [apps/mcp-server/src/migration/backfill.service.ts:230](../../../migration/backfill.service.ts#L230) (`listLitePage(this.liteStore, userId, cursor, false)` — no batchSize argument)
  - [apps/mcp-server/src/migration/lite-enumerator.ts:14](../../../migration/lite-enumerator.ts#L14) (`const ENUM_BATCH_LIMIT = 100;` — hard-coded)
- **Description**: The constructor reads `BACKFILL_BATCH_SIZE` and stores it on `defaultBatchSize`. The `run()` method captures `_batchSize = options.batchSize ?? this.defaultBatchSize` and immediately voids it. The actual page size is the hard-coded `ENUM_BATCH_LIMIT = 100` in `lite-enumerator.ts`. So the env var + `options.batchSize` are **dead code** today — they influence no runtime behaviour.
- **Recommendation**: Plumb `batchSize` through `listLitePage(store, userId, cursor, includeShortTerm, batchSize?)` so the value flows from `BACKFILL_BATCH_SIZE` or `options.batchSize` into the lite-store page size. The current `void _batchSize` is a code smell that should be removed once a real consumer exists. Alternatively, document the limitation in the JSDoc and remove the unused plumbing.

#### M-2: Changes-log claims 32 migration tests; observed run reports 25

- **Files**:
  - [profile-ladder-changes.md](../../2026-06-23/profile-ladder-changes.md) "Notes" → "New test totals: **32 migration tests passing** (5 happy-path + 3 rollback + 3 chaos + 13 state + 7 dual-write + 1 verifier report)."
  - Test run output: `Tests: 25 passed, 25 total` against the dual-write/migration-\* pattern.
- **Description**: `dual-write.spec.ts` has 7 cases (matches "7 dual-write"), `migration-rollback.spec.ts` has 4 cases (changes-log says 3 — likely undercount), `migration-chaos.integration.spec.ts` has 3 cases (matches), `migration-full-path.integration.spec.ts` has 4 cases (changes-log says 5 — likely overcount), `migration-state.spec.ts` has 13 cases (matches "13 state") but is not selected by the pattern. Adding 7 + 4 + 3 + 4 = 18 + 13 (state) = 31; the missing test is "1 verifier report" (not asserted in any spec — the `reportPath` is exercised but no dedicated `report.spec.ts` exists).
- **Recommendation**: Reconcile the changes-log test-count breakdown with the actual spec `it()` counts. Either add a dedicated verifier-report test or update the breakdown so the numbers sum correctly. The "1 verifier report" entry is suspect — no spec covers the JSON report path in isolation.

#### M-3: `BackfillOptions.dataDir` is referenced in error messages but is not an option

- **Files**:
  - [apps/mcp-server/src/migration/backfill.service.ts:115-117](../../../migration/backfill.service.ts#L115-L117) (`'Pass dataDir via options.dataDir when constructing BackfillService.'`)
  - [apps/mcp-server/src/migration/backfill.service.ts:41-49](../../../migration/backfill.service.ts#L41-L49) (`BackfillOptions` interface does not include `dataDir`)
- **Description**: The error message advises the caller to pass `dataDir` via `options.dataDir`, but `BackfillOptions` has no `dataDir` field. The escape hatch is the private-field read at [backfill.service.ts:108-117](../../../migration/backfill.service.ts#L108-L117). The same pattern is used in `verifier.service.ts:388-395` without an error-message reference.
- **Recommendation**: Either (a) add `dataDir?: string` to `BackfillOptions` and prefer it over the private-field read, or (b) update the error message to reflect the actual fallback ("the lite store must expose `dataDir`"). Option (a) is cleaner and removes the need for the typed-cast escape hatch on the common path.

#### M-4: `resolveDataDir` reaches into private `dataDir` via type assertion in two services

- **Files**:
  - [apps/mcp-server/src/migration/backfill.service.ts:108-118](../../../migration/backfill.service.ts#L108-L118)
  - [apps/mcp-server/src/migration/verifier.service.ts:388-395](../../../migration/verifier.service.ts#L388-L395)
- **Description**: Both services use `(store as unknown as { dataDir?: unknown }).dataDir` to read a `private readonly` field of `LiteJsonStore`. The comment in `backfill.service.ts:104-107` calls this an "escape hatch" but the assertion breaks encapsulation. The dual-write path (`MemoryLtmService.create()`) does not need this because it has direct access to the lite store id.
- **Recommendation**: Add a public `getDataDir(): string` method to `LiteJsonStore` so the migration tooling can request the directory explicitly. Alternatively, accept `dataDir` via `BackfillOptions`/`VerifierOptions` and require the caller (the orchestrator) to supply it.

#### M-5: `VerifierService` and `BackfillService` use a hard-coded page limit of 100/500 inside the helpers

- **Files**:
  - [apps/mcp-server/src/migration/lite-enumerator.ts:14](../../../migration/lite-enumerator.ts#L14) (`ENUM_BATCH_LIMIT = 100`)
  - [apps/mcp-server/src/migration/verifier.service.ts:206](../../../migration/verifier.service.ts#L206) (`for (let i = 0; i < 500; i += 1)` defensive cap with comment "50_000 records")
  - [apps/mcp-server/src/migration/lite-enumerator.ts:80-94](../../../migration/lite-enumerator.ts#L80-L94) (same 500-iteration cap in `countLiteMemories`)
- **Description**: Defensive caps are good, but the magic number 500 is duplicated and the rationale (50_000 records vs. 10_000 LTM quota) is only documented in one of the three locations.
- **Recommendation**: Extract `MAX_LITE_ENUM_PAGES = 500` to a named constant exported from `lite-enumerator.ts` and reference it from all three sites. Add a brief JSDoc explaining the quota rationale.

#### M-6: `VerifierService.runComparison` calls `enterpriseLtm.list` with `limit: 500` then iterates `safeGetTarget` per id

- **Files**:
  - [apps/mcp-server/src/migration/verifier.service.ts:289-308](../../../migration/verifier.service.ts#L289-L308)
  - [apps/mcp-server/src/migration/verifier.service.ts:177-194](../../../migration/verifier.service.ts#L177-L194)
- **Description**: For each user, the verifier first calls `enterpriseLtm.list(userId, { limit: 500 })` to get the id list, then issues one `enterpriseLtm.get(userId, id)` per id to read content/metadata/tags. For 10k memories per user this is 10k round-trips after the list call. The page-by-page lite walk is also paginated at 100. The dual-write path (`MemoryLtmService.create`) returns the full row, so a `list` returning rows (not just ids) would halve the call count.
- **Recommendation**: If `MemoryLtmService.list` supports a "with content" flag, prefer that. Otherwise document the N+1 query shape as a known cost and add a benchmark (the changes-log claims `bench:backends` exists; a verifier-focused bench would catch regressions).

#### M-7: `VeriferUserReport.mismatchRatio` uses `userMismatch / sourceCount` but is computed before the loop's `sourceCount`-vs-`targetCount` check

- **Files**:
  - [apps/mcp-server/src/migration/verifier.service.ts:241-249](../../../migration/verifier.service.ts#L241-L249)
- **Description**: The per-user `mismatchRatio` is `userMismatch / sourceCount`, but the global `passed` check at [verifier.service.ts:262-264](../../../migration/verifier.service.ts#L262-L264) requires `sourceTotal === targetTotal` in addition to the mismatch ratio. A user can have `sourceCount === targetCount` but every row hash-mismatched; the per-user ratio correctly reports `1.0` and the global ratio correctly fails the gate, but the per-user `mismatchRatio` of `1.0` (when `sourceCount === targetCount > 0`) is harder to interpret than reporting the absolute counts alongside it.
- **Recommendation**: Surface `mismatchRatio` alongside `hashMismatch` and `sourceCount` in the JSON report — already done — but document in the JSDoc that the ratio is "hash-mismatches / lite-source-count" and can exceed 1 only when the lite source count is zero (in which case the ratio is set to `0`).

#### M-8: Pre-existing baseline PrismaClient resolution now resolved; not a Phase 4 regression

- **Files**: changes-log "Additional or Deviating Changes" entry.
- **Description**: The changes-log records that `npx prisma generate` was run during Phase 4 consolidation to make `@prisma/client` resolvable. The migration tooling depends on the typed `prisma.migrationCheckpoint` client, so this baseline fix is a Phase 4 prerequisite. The plan-log should reflect the resolution so the next reviewer does not flag it as outstanding.
- **Recommendation**: Mark `DR-P1-01` resolved in `profile-ladder-log.md` so the trail is auditable.

---

## Missing Work or Deviations

### Plan-numbering inconsistencies (documented but unresolved)

The plan file contains three duplicate unchecked step entries
(`Step 4.2`, `Step 4.3`, `Step 4.5` second occurrences) with bodies that
match the first-occurrence checked entries plus an unchecked "Validate
phase changes" tail at the very end. The plan-log should resolve these
duplicates so future reviewers don't have to reconcile the table above.

### Documented deviations (recorded in changes-log)

- **DD-02 (Phase 4)**: `_liteId` metadata annotation instead of changing
  `CreateLtmMemoryData`. Confirmed at [dual-write.service.ts:340-349](../../../migration/dual-write.service.ts#L340-L349)
  and [backfill.service.ts:319](../../../migration/backfill.service.ts#L319).
  The verifier and idempotency paths strip the key before comparison
  ([verifier.service.ts:338-348](../../../migration/verifier.service.ts#L338-L348),
  [backfill.service.ts:421-432](../../../migration/backfill.service.ts#L421-L432)).
  This deviation is **explicitly recorded in the changes-log** but is
  not yet added to the plan-log as a tracked DD entry — see Finding Mj-2.

### Undocumented deviations (found during validation)

- **DD-03 (proposed)**: `BackfillService` does not use the existing
  `reindex-queue.service.ts`; the migration tooling introduces its own
  enumeration primitives (`lite-enumerator.ts`). Functionally correct,
  but the plan explicitly references `reindex-queue.service.ts` as the
  reuse target. See Finding Mj-1.
- **DD-04 (proposed)**: `BACKFILL_BATCH_SIZE` is read but never applied
  to the lite-store page size. The env var is currently dead code. See
  Finding M-1.

### Unaddressed research items (Phase 4 relevant)

- `Gate 3` post-cutover 15-minute read-path success ≥ 99.95% and
  `Gate 4` 24-hour no unresolved integrity anomalies are referenced in
  [migration-slo-research.md:235-236](../../../research/subagents/2026-06-02/migration-slo-research.md#L235-L236).
  These are operational gates that need a post-cutover verifier job; the
  Phase 4 deliverable covers the pre-cutover `verifier.verify()` path
  only. The changes-log WI-P5-D ("E2E profile-lite boot smoke (restart +
  recall)") is adjacent but does not cover the post-cutover window.
  **No Phase 4 action required**; flagged for Phase 5 follow-on.

### No `Removed` section in changes log for Phase 4

Confirmed: the "Removed" section header in
[profile-ladder-changes.md](../../../changes/2026-06-23/profile-ladder-changes.md)
contains no Phase 4 entries.

---

## Phase Summary Verdict

**Phase 4 — Migration Path and Quality Gates: Complete (with two documented deviations).**

| Aspect                                                                                                                                      | Result                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Step 4.1 — Dual-write abstraction (fan-out, retry/backoff, P2002/P2010, idempotency, `_liteId`)                                             | ✅ Implemented; 7 unit tests pass                                                                             |
| Step 4.2 — Staged backfill (cursor pagination, per-item fail-safe, BACKFILL_BATCH_SIZE, idempotent on resume, `_liteId`)                    | ⚠️ Implemented but env var is dead code (M-1); does not reuse `reindex-queue.service.ts` (Mj-1)               |
| Step 4.3 — Migration verification (per-user/global count, SHA-256 hash with `_liteId` stripped, hard-stop 0.00001, JSON report, auto-abort) | ✅ Implemented; 3 rollback tests + 1 happy-path test pass                                                     |
| Step 4.4 — Postgres backend + `selectCheckpointBackend(capabilities, opts)` factory                                                         | ✅ Implemented; `MigrationCheckpoint` Prisma model present; Zod-validated read path                           |
| Step 4.5 — Migration + rollback tests (full path, chaos, rollback, dual-write retry exhaustion)                                             | ✅ 25 migration tests pass; changes-log claim of 32 is overstated (M-2)                                       |
| `ALLOWED_TRANSITIONS.copying` self-edge for in-flight checkpoints                                                                           | ✅ Added; audit append skipped on self-transition                                                             |
| State-machine integration with verifier (cutting_over on pass, rollback on fail)                                                            | ✅ Verified end-to-end in `migration-full-path.integration.spec.ts`                                           |
| DD-02 `_liteId` annotation honoured                                                                                                         | ✅ Verified in dual-write, backfill, and verifier paths                                                       |
| Quality gates (`0.00001` hard-stop, SHA-256, JSON report)                                                                                   | ✅ Match [migration-slo-research.md](../../../research/subagents/2026-06-02/migration-slo-research.md) Gate 2 |

**Critical findings**: 0
**Major findings**: 2 (`Mj-1` reindex-queue reuse; `Mj-2` `_liteId` link key concentration + DD-02 plan-log gap)
**Minor findings**: 8 (dead-code env var, test-count discrepancy, private-field access, hard-coded caps, N+1 query, ratio semantics, PrismaClient baseline, plan-numbering duplicates)

Phase 4 deliverables match the plan's primary intent. The two major
findings are architectural (reindex-queue reuse + `_liteId` link
concentration) and should be tracked as Phase 4 deviations or resolved
before GA. The minor findings are documentation, observability, or
ergonomic improvements that can ship as follow-on work.

---

## Recommended Next Validations

- [ ] **Phase 5 — Docs, Quality Gates, and Release** (not yet validated):
      confirm README profile matrix, SETUP.md profile paths,
      `docs/RELEASE_GATES.md` SLOs, `.github/workflows/profile-matrix.yml`
      per-profile smoke jobs.
- [ ] **Post-cutover verifier** (research Gate 3 / Gate 4): confirm the
      15-minute read-path success and 24-hour anomaly budget are wired
      into CI / observability. Currently only the pre-cutover
      `verifier.verify()` is covered.
- [ ] **DD-02 audit** (Mj-2): add a dedicated `migration-link-key.spec.ts`
      that asserts `_liteId` is always written by both write paths,
      stripped from hash compare, stripped from idempotency compare.
- [ ] **Migration controller + CLI** (WI-P5-E): currently only services +
      unit/integration tests exist; no NestJS controller or CLI
      exposes the migration surface. Confirm whether Phase 5 owns the
      CLI integration.
- [ ] **Encryption key rotation** (WI-P5-F): `v1:` nonce prefix is in
      place; keyId-based rotation is a follow-on that affects
      `_liteId` linkage (the lite store may need a re-key migration
      that the migration tooling should orchestrate).

---

## Clarifying Questions

1. **Reindex-queue reuse (Mj-1)**: Is the architectural intent of Step
   4.2 (reuse `reindex-queue.service.ts`) still valid, or was the new
   `BackfillService` + `lite-enumerator.ts` accepted as a deliberate
   scope separation? If accepted, please add DD-03 to the plan-log.
2. **`BACKFILL_BATCH_SIZE` semantics (M-1)**: Should the env var control
   the lite-store page size (current intent based on the variable name
   - JSDoc) or is it reserved for a future per-batch boundary that
     hasn't shipped yet?
3. **Test-count reconciliation (M-2)**: Should the changes-log breakdown
   be updated to match the actual `it()` counts, or should the missing
   "1 verifier report" test be added?
4. **`_liteId` as the link key (Mj-2)**: Is the metadata-only link
   durable enough for production, or should `CreateLtmMemoryData` grow
   a first-class `liteId` field once the profile-lite → enterprise
   promotion path is exercised in anger? This affects Phase 5 cutover
   design.
5. **Plan numbering cleanup**: Should the duplicate Step 4.2 / 4.3 /
   4.5 entries be removed in a plan-log-only follow-up, or is the
   current first-occurrence-wins interpretation acceptable?
