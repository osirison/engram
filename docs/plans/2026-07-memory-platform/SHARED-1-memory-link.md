---
title: SHARED-1 — Canonical MemoryLink Schema
description: Reconciled MemoryLink model (typed memory→memory edges) shared by WP2/WP3/WP4
---

# SHARED-1 — Canonical `MemoryLink` schema (reconciled)

WP3 (§5) and WP4 (§6) each drafted a `MemoryLink` model; they diverge. **This file is
the canonical definition** — it supersedes both drafts. Executors of SHARED-1 implement
exactly this; WP3/WP4 task references to SHARED-1 mean this model.

## Why reconciliation was needed

| Concern                   | WP3 draft                                                 | WP4 draft                                   | Canonical decision                                                                                                                  |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Unresolved/dangling links | not representable                                         | `targetMemoryId` nullable + `targetLocator` | **WP4**: nullable target + locator — import needs deferred resolution                                                               |
| Referential integrity     | FK to `Memory`, `onDelete: Cascade`                       | no FK, app-level cleanup                    | **WP3**: FKs. Source cascades; target `SetNull` (delete ⇒ link reverts to unresolved, locator retained)                             |
| Edge vocabulary           | `relType` closed `EDGE_TYPES` + `origin` authored/derived | free-ish `type` + metadata                  | **WP3**: `relType` + `origin` — durable-vs-derived is load-bearing (GAPS A11)                                                       |
| Tenancy/scan columns      | none                                                      | `userId`, `organizationId`                  | **WP4**: keep — deferred-resolution scan is `(userId, targetLocator)` without joins                                                 |
| Uniqueness                | `(source, target, relType)`                               | `(source, targetLocator, type)`             | **WP4 shape**: `(sourceMemoryId, targetLocator, relType)` — subsumes WP3's given deterministic locators (`id:<cuid>` once resolved) |

## Canonical model

```prisma
model MemoryLink {
  id             String   @id @default(cuid(2))
  userId         String
  organizationId String?
  sourceMemoryId String
  targetMemoryId String?  // NULL while unresolved (deferred/dangling)
  targetLocator  String   // normalized: 'id:<cuid>' | 'slug:<slug>' | 'path:<rel>#<anchor>'
  relType        String   // closed set enforced in Zod: EDGE_TYPES (WP3 §4.3)
  origin         String   @default("authored") // 'authored' | 'derived'
  score          Float?
  note           String?
  metadata       Json?    // { rawTarget, kind, sourceTool, importBatchId }
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user   User    @relation("MemoryLinkUser", fields: [userId], references: [id], onDelete: Cascade)
  source Memory  @relation("MemoryLinkSource", fields: [sourceMemoryId], references: [id], onDelete: Cascade)
  target Memory? @relation("MemoryLinkTarget", fields: [targetMemoryId], references: [id], onDelete: SetNull)

  @@unique([sourceMemoryId, targetLocator, relType])
  @@index([userId, targetLocator]) // deferred-resolution scan
  @@index([targetMemoryId])
  @@index([sourceMemoryId])
  @@map("memory_links")
}
```

Back-relations to add: on `Memory` — `outgoingLinks MemoryLink[] @relation("MemoryLinkSource")`,
`incomingLinks MemoryLink[] @relation("MemoryLinkTarget")`; on `User` —
`memoryLinks MemoryLink[] @relation("MemoryLinkUser")`.

## Invariants both WPs rely on

1. **Locator determinism**: a resolved link's `targetLocator` is always `id:<cuid>` of the
   target; slug/path locators exist only while unresolved. Same target ⇒ same locator ⇒
   the unique constraint prevents re-import doubling (WP3 round-trip test depends on this).
2. **Target deletion** flips a link back to unresolved (`SetNull`) — export renders it per
   WP3's dangling policy (plain text); a later import of the target may re-resolve it via
   `targetLocator` only if a non-`id:` locator is retained in `metadata.rawTarget` (importer
   responsibility, WP4 T5).
3. **Derived edges** (`origin: 'derived'`) are regenerable and excluded from the round-trip
   comparison (WP3 §4.10); durable edges must survive export→import byte-identically.
4. Migration serializes with SHARED-2 (`MemoryAuditLog`, WP2) and WP4's
   `MemoryImportSource` ledger — one migration PR each, any order.
