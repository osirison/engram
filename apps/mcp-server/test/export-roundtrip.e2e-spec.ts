/**
 * Export → import round-trip contract (G6) — DB side. **STUB (WP4 completes this).**
 *
 * WP3 ships the parse-side proof of the round-trip in
 * `packages/memory-interchange/src/roundtrip.spec.ts` (fully passing). This e2e
 * stub reserves the DB-import half so the contract is visible to WP4 executors
 * and lands in the e2e config; it is intentionally `it.todo` until WP4's
 * importer exists.
 *
 * The contract WP4 must satisfy (PLAN §4.10, via `durableProjection` from
 * `@engram/memory-interchange`):
 *
 *   1. Seed a user, export via `MemoryExportService` + `DirectorySink` to a temp
 *      vault.
 *   2. Import that vault into a CLEAN test DB using the WP4 importer, with
 *      detection disabled (`skipDuplicateCheck: true`, no contradiction pass) so
 *      derived edges are not doubled.
 *   3. For each memory: `durableProjection(reimported)` deep-equals
 *      `durableProjection(exported)` — i.e. id, content, tags, type, scope, and
 *      DURABLE edges are reproduced.
 *   4. Volatile fields (`updatedAt`, `importance`, `accessCount`, `detectedAt`, …)
 *      and derived-edge counts are explicitly NOT required to match.
 *   5. The `MemoryLink` `@@unique(sourceMemoryId, targetLocator, relType)`
 *      constraint (SHARED-1) makes a second import idempotent (no doubling).
 *
 * Run (WP4): see `memory-system.e2e-spec.ts` for the infra + env preamble.
 */
const E2E_ENABLED = process.env.E2E_ENABLED === 'true';
const suite: (name: string, fn: () => void) => void = E2E_ENABLED
  ? describe
  : describe.skip;

suite('export → import round-trip (G6) — DB side [WP4 completes]', () => {
  it.todo(
    'exports a seeded user to a temp vault (MemoryExportService + DirectorySink)',
  );
  it.todo(
    'imports the vault into a clean DB via the WP4 importer, detection disabled',
  );
  it.todo(
    'durableProjection(reimported) deep-equals durableProjection(exported) per memory',
  );
  it.todo('does not require volatile fields or derived-edge counts to match');
  it.todo(
    're-import is idempotent via MemoryLink @@unique(source, targetLocator, relType)',
  );
});
