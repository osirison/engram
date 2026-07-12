---
title: Concurrent-writer policy
description: How ENGRAM resolves concurrent updates to the same memory across the UI, agents, and imports — optimistic version CAS, when it is enforced, and the deliberate deferrals (gap G4)
---

# Concurrent-writer policy

ENGRAM lets multiple writers touch the same memory: the web console, several
agents, and the import pipeline. This document is the source of truth for how
those writes are ordered. It closes cross-cutting gap **G4** (see
[`plans/2026-07-memory-platform/GAPS.md`](./plans/2026-07-memory-platform/GAPS.md)).

## Mechanism

Every `Memory` row carries a monotonic `version` column (SHARED-2). An update may
pass `expectedVersion`; the LTM `update()` folds it into the `WHERE` clause and
bumps `version` in the same statement (a compare-and-set). A mismatch surfaces as
`LtmVersionConflictError` → a `CONFLICT:` client error (HTTP 409 on the web path).
At the MCP tool boundary, `update_memory` **requires** `expectedVersion` (both
tiers); omitting it is rejected before any write with a `CONFLICT:`-prefixed
message telling the agent to re-read (`get_memory`) and retry with the version it
read. The update audit row's `after` snapshot records the bumped `version`.
`reembed` deliberately does **not** bump `version` — it rewrites the vector, not
user content, so it must not invalidate a concurrent editor's `expectedVersion`.

## Policy by writer

| Writer                                                    | Policy                                                                                                                                                                                                        | Rationale                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web console**                                           | **Requires** `expectedVersion` (sends the version it read); a 409 opens a reload-and-rediff panel.                                                                                                            | A human editing stale content must see the conflict, never silently clobber. Already enforced (WP2).                                                             |
| **Agent `update_memory`**                                 | **Rejects a blind update** — `expectedVersion` is required; omitting it returns a `CONFLICT`-class error explaining the memory must be re-read first.                                                         | Conservative / never-lose-data (qp): agent-to-agent overwrites are the multi-writer hazard G4 names. Decision 12 (reject-blind) **ENFORCED 2026-07-12** (G4-T2). |
| **Import (`import_agent_memory`)**                        | **CAS-skip**: the importer passes `expectedVersion`; on conflict it **skips** that memory and increments a `skippedConcurrentEdit` counter in the run summary for the operator to reconcile.                  | Never clobber a concurrent agent edit with a source-file re-import. Enforced by **G4-T3**.                                                                       |
| **STM (`update`)**                                        | Read-compare-set (non-atomic, ms window). **A true Redis Lua CAS is deferred.**                                                                                                                               | STM is TTL-bounded and low-stakes; the window is milliseconds. Revisit (G4-T4) only if a real interleaving is observed.                                          |
| **Lifecycle jobs** (decay, supersede, dedup-link, access) | Route through version-checked writes + emit audit where a user-visible mutation occurs. Access bookkeeping is version-keyed but NON-bumping, so a read-then-update never conflicts with its own access write. | Prevents a background pass from silently clobbering a concurrent user edit. Enforced by **G3-T3**.                                                               |

## Deliberate deferrals

- **STM atomic CAS (G4-T4)** — the STM `update()` remains a documented read-compare-set.
  The ms-scale window on TTL-bounded data is accepted; a Redis Lua CAS would close it but
  is not built this round.

## Invariants (must not regress)

1. The web edit path always sends `expectedVersion`; a version-conflict test guards it.
2. `reembed` never bumps `version`.
3. Import must not change the `MemoryImportSource` `@@unique([userId, sourceKey])` idempotency
   key while adding CAS (shared with the export→import round-trip, G6).
