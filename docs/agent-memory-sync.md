---
title: Agent Memory File-Watcher Sync
description: The ongoing file-watcher bridge that keeps native agent-memory files synced into ENGRAM, with the D7 newest-wins conflict rule
---

> Also published at [engram.events/docs/agent-memory/sync/](https://engram.events/docs/agent-memory/sync/). This repository copy is canonical — agents read it at runtime.

# Agent Memory File-Watcher Sync

The one-time [migration runbook](./agent-memory-migration.md) imports existing
native memory once. The **sync bridge** keeps ENGRAM current afterward: it
watches native agent-memory files and re-imports the ones that change, so nothing
important lives only on disk. It reuses the WP4 importer (parsing, dedup,
provenance, link resolution) unchanged and adds one rule.

## What it watches

On a change under a watched root, the file is mapped to its WP4 importer source
and that source is re-imported (the importer's ledger makes re-runs idempotent —
only changed facts update):

| File(s)                                                                     | Source        |
| --------------------------------------------------------------------------- | ------------- |
| `CLAUDE.md`, `CLAUDE.local.md`, `.claude/**/memory/*.md`                    | `claude-code` |
| `AGENTS.md`                                                                 | `codex`       |
| `GEMINI.md`                                                                 | `gemini`      |
| `.cursor/rules/*.mdc`, `.cursorrules`                                       | `cursor`      |
| `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `copilot`     |

Bursty writes (editor temp-file + rename) are debounced so one import runs after
the writes settle, not one per raw filesystem event.

## D7 — never clobber a newer ENGRAM edit

If a memory imported from a file was later edited **inside ENGRAM** (via the UI or
another agent), its `updatedAt` is newer than the last import recorded in the
import ledger. Re-importing the file would overwrite that edit, so the sync
bridge detects the conflict, logs it, and **skips** that source's import instead
of clobbering — the file change waits for manual reconciliation. Run with
`--force` to override. (This is one-way: files → ENGRAM. Exporting ENGRAM back to
files is WP3's job, kept separate.)

### Conflict copies — nothing is lost (#239)

When the skip fires and the file has **genuinely diverged** (its content differs
from both the last import and the memory's current content), the file's version
is stored as a separate **`conflict`-tagged memory** in the dedicated
`sync-conflict` scope, linked to the contested memory via
`metadata.conflict.memoryId` (plus `sourceKey`, `sourcePath`, `contentHash`).
The contested memory is never touched. Guarantees:

- **One live copy per contested memory** — re-running the sync on the same
  unresolved conflict is a no-op; a further file edit refreshes the single
  copy in place (latest file version wins for review), never a second copy.
- **No copy for noise** — a memory-only edit (file unchanged since import) or a
  file already matching the ENGRAM edit stores nothing.
- **Automatic cleanup** — once a later sync actually imports or reconciles the
  source (the conflict clears), the stale copy is removed.

To reconcile: either update the source file to match the ENGRAM edit, or accept
the file's version by pasting the copy's content into the contested memory —
then re-run with `--force`. The importer detects the convergence (file content
now equals the memory), refreshes the ledger without writing the memory
(`reconciled` in the run summary), the conflict clears, and the copy is removed.

### Multi-root ledger namespacing (#236)

Ledger keys are namespaced per import root
(`<tool>@<12-hex-root-fingerprint>:<relpath>[#anchor]`), so watching two
projects that share a relative path (e.g. two repos each with a `CLAUDE.md`) no
longer collides on one ledger row. Pre-existing rows under the bare
`<tool>:<relpath>` key are renamed in place on their first re-import — same
memory, no duplicates. The `(userId, sourceKey)` unique key structure is
unchanged.

## Running it

> Requires **Node ≥ 20** — the daemon watches recursively (for nested
> `.github/instructions/`, `.cursor/rules/`, `.claude/**/memory/`), which older
> Node does not support on Linux. On an unsupported runtime it logs a clear error
> and exits instead of silently missing changes.

One-off pass (verification / cron):

```bash
pnpm --filter mcp-server watch -- "$PWD" --user qp --scope project:engram --once
```

As a long-lived daemon (systemd user service, alongside the MCP server — see
[`agent-memory-server.md`](./agent-memory-server.md)):

```bash
cp deploy/systemd/engram-sync.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now engram-sync.service
journalctl --user -u engram-sync -f
```

The watcher needs the same database/Redis environment as the server (it writes
via the importer), so the unit reads the same `~/.engram/engram-mcp.env`. Identity
is `userId: "qp"`; scope follows the [contract](./agent-memory-contract.md).

## Verify

1. Edit a watched file (e.g. add a line to `AGENTS.md`) → the daemon logs a
   `synced codex` line and `recall` returns the new fact.
2. Edit the same file again with no content change → no duplicate is created.
3. Edit the memory in ENGRAM, then edit the file → the daemon logs a
   `sync conflict` and does not overwrite the ENGRAM edit.
