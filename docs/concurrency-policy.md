---
title: Concurrent-writer policy
description: How ENGRAM resolves concurrent updates to the same memory across the UI, agents, and imports — optimistic version CAS, when it is enforced, and the deliberate deferrals (gap G4)
---

This page has moved. See
[Concurrent-writer policy — ENGRAM Developer Docs](https://engram.events/docs/reference/concurrency-policy/).

The published page is the source of truth for the per-writer policy table,
including Decision 12 (agent `update_memory` rejects blind updates —
`expectedVersion` required) and Decision 13 (import CAS-skip via the ledger's
`lastWrittenVersion`), both referenced from code comments as
`docs/concurrency-policy.md`.
