---
title: Agentic Memory Import
description: Import agent-memory files (Claude, Copilot, Cursor, Codex, Gemini, generic markdown) into ENGRAM long-term memory, preserving inter-memory links.
---

# Agentic Memory Import (WP4)

ENGRAM can ingest the "agent memory" your AI coding tools keep on disk —
instructions, learned facts, project conventions — as first-class long-term
memories, **preserving the links between them** (Claude auto-memory
`[[wikilinks]]`, instruction-file relative links, WP3-export typed edges). The
importer is safe to re-run, redacts secrets before embedding, and controls
embedding cost on the first bulk import.

## Sources

| `source`      | Reads                                                                                  | Chunking                         |
| ------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| `claude-code` | `memory/*.md` auto-memory (`MEMORY.md` index excluded) + `CLAUDE.md`                   | 1 file = 1 memory / H2           |
| `copilot`     | `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`           | H2 / 1 file                      |
| `cursor`      | `.cursor/rules/*.mdc` + legacy `.cursorrules`                                          | 1 file / H2                      |
| `codex`       | `AGENTS.md` hierarchy (repo + nested; `--include-global` adds `~/.codex`)              | H2 split                         |
| `gemini`      | `GEMINI.md` hierarchy (`--include-global` adds `~/.gemini`); `@import` links preserved | H2 split                         |
| `markdown`    | any `.md` folder / Obsidian vault (index/MOC skipped)                                  | 1 file (`--split-headings` → H2) |

Each adapter converts its on-disk format into a common intermediate
representation, then a shared pipeline redacts secrets, deduplicates, persists,
and resolves links. See [AGENTS.md](../AGENTS.md) for the repo overview.

## CLI

```bash
pnpm --filter mcp-server import -- <source> <path> \
  --user <id> [--scope <s>] [--dry-run] \
  [--secrets redact|flag|skip|fail] [--no-embed] \
  [--split-headings] [--include-global]
```

Example — preview a Claude auto-memory import without writing anything:

```bash
pnpm --filter mcp-server import -- claude-code ~/.claude/projects/<slug> \
  --user qp --dry-run
```

The CLI exits non-zero when any fact failed or a quota stop occurred.

## MCP tool

`import_agent_memory` is **admin-gated** (it reads a server-side path and
bulk-writes): the caller must pass an `adminToken` matching `MCP_ADMIN_TOKEN`.
Parameters mirror the CLI (`source`, `path`, `userId`, `scope?`, `dryRun?`,
`secretsPolicy?`, `embed?`, `splitHeadings?`, `includeGlobal?`). The tool is not
advertised under the memory/lite profiles (it requires Postgres).

## Idempotency

Import is safe to re-run. A per-source **ledger** (`memory_import_sources`,
unique on `(userId, sourceKey)`) records each imported fact's content hash:

- unchanged hash → **skipped** (no-op);
- changed hash → **updated** in place (re-embedded);
- byte-identical content from another source → **merged** into the existing
  memory, appending to `metadata.provenance.sources[]` (multi-source).

Dedup is `scope`-bound (default `import`); link resolution is `userId`-scoped, so
a Claude fact can link a Cursor rule.

## Links & deferred resolution

Wikilinks and relative markdown links become first-class `memory_links` rows. A
link whose target hasn't been imported yet is stored **deferred** (null target,
locator retained) and auto-resolved on a later import of the target. Links that
never resolve stay **dangling** (reported in the summary). Deleting a memory
reverts inbound links to unresolved (FK `SET NULL`) so a re-import re-resolves
them.

## Secrets (`--secrets`, closes G2)

Every fact is scanned before persistence. Under the default `redact` (and under
`skip` / `fail`) no raw secret reaches an external embedding provider. `flag` is
the exception: it deliberately keeps the raw content, so see the caveat below.

| Policy   | Behavior                                                           |
| -------- | ------------------------------------------------------------------ |
| `redact` | replace matches with `[REDACTED]` and record the pattern (default) |
| `flag`   | keep content, set `metadata.embeddingExcluded`, tag `has-secret`   |
| `skip`   | drop the whole fact (counted `secretsSkipped`)                     |
| `fail`   | abort the run before any write                                     |

`flag` marks a fact `embeddingExcluded` and omits it from the embedding-cost
estimate, but persistence still embeds inline when an external provider is
configured. To keep flagged raw content out of an external provider at import
time, run `flag` together with `--no-embed` (or `EMBEDDING_PROVIDER=disabled`),
then backfill with `reindex` — which honors `embeddingExcluded`. Per-fact
embedding suppression inside `create()` is a tracked follow-up.

Dry-run lists the files + matched pattern names.

## Embedding cost (`--no-embed`, closes G7)

Dry-run reports an embedding cost estimate (`≈ chars/4 × model rate`). For a
cheap first bulk import, run with `--no-embed` (or `EMBEDDING_PROVIDER=disabled`)
to store memories with empty vectors, then backfill with the cursor-resumable
reindex:

```bash
pnpm --filter mcp-server reindex
```

## Error handling

Per-fact failures are counted and skipped (Postgres stays the source of truth).
Hitting the per-user quota stops the run **gracefully** with a partial summary
and a resumable cursor, rather than crashing.
