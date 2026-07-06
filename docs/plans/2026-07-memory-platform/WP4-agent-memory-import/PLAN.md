---
title: WP4 — Agentic Memory Import Plan
description: Implementation plan for importing agent memories (Claude/Copilot/Cursor/Codex/Gemini) with links, provenance, and dedup (SHARED-1 + T1–T16)
---

# WP4 — Agentic Memory Import (Implementation Plan)

> Status: DRAFT (ready to execute). See `../README.md` for suite-wide conventions
> (worktree, conventional commits with body ≤300 chars, testing at **both** the
> service and wiring level, Postgres-as-source-of-truth, `userId: "qp"` in examples).
> Cross-cutting gaps this WP must honor: `../GAPS.md` — **G2** (secret/PII scan on
> import), **G4** (idempotency / concurrent writers), **G6** (export↔import
> round-trip contract shared with WP3), **G7** (embedding cost/rate control on bulk).
>
> Audience: a single model (Opus 4.8 / Sonnet 5) executing **one** task below with
> no other context. Every task is self-contained: exact paths, steps, acceptance
> criteria, and tests. Read `CLAUDE.md` + `AGENTS.md` at repo root first.

---

## 1. Context

qp uses several AI coding tools (Claude Code, GitHub Copilot, Cursor, OpenAI Codex,
Gemini) plus generic markdown vaults (Obsidian). Each stores "agent memory" — durable
instructions, learned facts, project conventions — in tool-specific files. This WP adds
an **importer** that ingests those files into ENGRAM's memory store as first-class
long-term memories, **preserving the links between them** (e.g. a Claude auto-memory
fact `[[feedback-worktree]]` wikilink, or a `[AGENTS.md] → ../AGENTS.md` relative link),
so the imported corpus keeps its graph structure inside ENGRAM.

The importer must be safe to re-run (idempotent), must not leak secrets that instruction
files routinely contain, must control embedding cost on first bulk import, and must
resolve links even when the link target is imported in a **later** run.

This plan defines a **source-adapter architecture**: one adapter per tool converts that
tool's on-disk format into a common **intermediate representation (IR)** of
`{ facts, links, provenance }`; a shared pipeline then redacts secrets, deduplicates,
persists to Postgres via the existing `MemoryLtmService`, resolves links into a new
`MemoryLink` relationship table, and (optionally) embeds. WP5 ("Engram as primary
agent memory") builds on the provenance/importer concepts defined here.

---

## 2. Current state (verified file:line refs)

All references verified by reading the files in this worktree on 2026-07-05.

### Memory model & storage

- `prisma/schema.prisma:84-117` — the single `Memory` model. Fields relevant to import:
  `id` (cuid2), `userId`, `organizationId?`, `scope?` (namespace string, e.g.
  `project:<id>`), `content @db.Text` (**≤10KB** per app conventions), `metadata Json?`,
  `tags String[]`, `type` (`'short-term' | 'long-term'`), `createdAt/updatedAt`,
  `expiresAt?` (STM only), `embedding Float[]`, `embeddingVec Unsupported("vector(1536)")`.
- **There is no relationship/link model and no content-hash column** in the schema.
  Duplicate/supersede relationships are today stored only as _metadata annotations_
  (`duplicateOf`, `supersededBy`) — see below. → SHARED-1 introduces `MemoryLink`.
- `prisma/schema.prisma:130-146` — `MigrationCheckpoint` shows the repo's precedent for a
  cursor/progress/history table (`cursor`, `progress`, `history Json`); useful shape
  reference for the import-ledger and resumable imports.

### LTM create/update path (where imports land)

- `packages/memory-ltm/src/memory-ltm.service.ts:106-261` — `MemoryLtmService.create()`.
  Order: runs ingest sync steps (privacy filter + content hash) → **exact-content dedup
  returns the existing row silently** (`:139-148`) → null-safe embedding (`:150-157`) →
  semantic dedup (annotates `duplicateOf`) → contradiction detection (annotates
  `supersededBy`) → quota-gated insert (`:214-225`) → non-fatal vector index (`:246`).
- `:803-834` `createRowWithQuota()` — atomic per-user quota via `pg_advisory_xact_lock`;
  throws `LtmMemoryQuotaExceededError` (**re-thrown, not swallowed**, at `:254-260`) when
  `maxMemoriesPerUser` is reached. Bulk import must handle this (see Risks).
- `:311-415` `update()` — re-embeds on content change (null-safe), merges metadata.
  This is the path an idempotent **update-on-drift** import re-uses.
- `:1184-1287` `reindex()` — **cursor-resumable, idempotent** vector backfill; per-item
  failures counted+skipped; returns `{processed,indexed,skipped,failed,cursor}`. The
  "import cheap, embed later" path (G7) leans on this.
- `findExactDuplicate()` (`:1432-1452`) and `findDuplicate()` (`:1468-1484`) are
  **scope-bound**: `scope ?? null` — dedup only collapses memories in the _same_ `scope`.
  This constrains the import `scope` decision (§5).

### Ingest pipeline (reusable secret-scan + hashing precedent)

- `packages/memory-ltm/src/ingest/privacy-filter.step.ts:10-63` — `PrivacyFilterStep`:
  **9 regex patterns** (PEM keys, AWS `AKIA…`, GitHub `ghp_…`, Bearer tokens, generic
  `api_key=…`, passwords, SSN, credit-card, `<private>` blocks) → replaces with
  `[REDACTED]`; records `redactions[]`. **Reuse & extend** for the import secret stage.
- `packages/memory-ltm/src/ingest/ingest-pipeline.service.ts:111-113` — `computeHash()` =
  `sha256(content.trim().toLowerCase())`. **This is the canonical content-hash** the
  import ledger should reuse for drift detection.

### Embeddings

- `packages/embeddings/src/embeddings.service.ts:40-122` — `generate({text})` returns
  `null` (never throws) when the provider/API is unavailable; SHA-256 Redis cache
  (`EMBEDDING_CACHE_TTL`). **No batch/`generateMany` API exists** → G7 batching is an
  enhancement (T14). `EMBEDDING_PROVIDER=disabled` ⇒ every `generate()` returns null ⇒
  memories store with empty `embedding[]` and no external calls.

### MCP tools + admin gate + CLI precedent

- `packages/core/src/mcp/tools/index.ts:33-61` — `Tool` interface:
  `{ name, description, inputSchema (Zod), handler, auth?, requiredScope?, delegable? }`.
  `auth: 'admin'` tools carry their own `adminToken` gate; `'public'`/`'identity'` otherwise.
- `packages/core/src/mcp/tools/ping.tool.ts:35-42` — minimal tool shape; schema is
  `z.object({}).strict()`.
- `apps/mcp-server/src/memory/memory.controller.ts:1075-1200` — `getMcpTools()` builds the
  live tool array (`create_memory`, `recall`, `reindex_memories`, …). **Register the new
  `import_agent_memory` tool here.**
- `apps/mcp-server/src/memory/memory.controller.ts:115-131` — `assertAdminAuthorized()`
  (constant-time compare vs `MCP_ADMIN_TOKEN`); `:452-492` `reindexMemories()` shows the
  admin-tool handler shape. Model the import tool on this.
- `apps/mcp-server/src/reindex.cli.ts:1-111` — **standalone CLI precedent**:
  `NestFactory.createApplicationContext(AppModule.forRoot())`, arg parsing, calls a
  service, sets `process.exitCode` on failures. Model `import.cli.ts` on this.
- `apps/mcp-server/package.json:16` — `"reindex": "nest build && node dist/reindex.cli.js"`.
  Add a sibling `"import"` script.
- `apps/mcp-server/src/memory/conversation-chunking.ts:17-83` — `splitTurnsToChunks()`,
  `INGEST_CHUNK_CHAR_LIMIT = 10_240`, `INGEST_MAX_CHUNKS = 500`. **Reuse the ≤10KB
  splitter** for oversized instruction-file sections; mirror the per-chunk metering cap.
- `packages/memory-ltm/src/duplicate-detection.service.ts` — existing semantic-dup service
  the create() path uses; import inherits it for free.

### Prior art: `apps/vscode-copilot-compressor`

- Inspected `apps/vscode-copilot-compressor/src/*` (`extension.ts`, `chat-participant.ts`,
  `context-compressor.ts`, `caveman-mode.ts`) + `prompts/caveman.prompt.md`. **It is a
  VS Code chat extension** that registers a Copilot `@caveman` chat participant and
  compresses conversation context for token savings. **It does NOT read or write Copilot
  instruction files and is NOT a memory importer** — it is unrelated to WP4 beyond sharing
  the "Copilot" name. No reusable code for this WP; do not wire into it.

---

## 3. Source format reference (the load-bearing section)

This is what a lower model **cannot infer**. Each subsection gives file locations, format,
link syntax, and the field→memory mapping. **Verification tags:** `[V]` = verified against
a real sample on this machine (path cited); `[A]` = assumed from training data — the
relevant adapter task carries a `Verify` step to confirm before coding.

### 3.0 Two link syntaxes (applies across sources)

1. **Wikilinks** `[[target]]`, `[[target|alias]]`, `[[target#heading]]` — used by Claude
   auto-memory fact files and Obsidian vaults. Target = a note/file **stem** (no `.md`). `[V]`
2. **Relative markdown links** `[text] → relative/path.md` and `[text] → ../AGENTS.md` —
   used by instruction files (CLAUDE.md, AGENTS.md, copilot-instructions.md). Target = a
   **path** relative to the containing file. `[V]` (seen in engram
   `copilot-instructions.md`: `[AGENTS.md] → ../AGENTS.md`, `[README.md] → ../README.md`).

The link-resolution engine (T5) normalizes both to a `targetLocator` (`slug:<stem>` or
`path:<normalized-repo-relative-path>[#anchor]`) and resolves against imported facts.

### 3.1 Claude Code `[V]` (live sample read read-only during planning)

Sample: `/home/qp/.claude/projects/-home-qp-Cloud-Projects-engram/memory/` (canonical).

**Three source kinds:**

1. **Project instructions** — `CLAUDE.md` and `CLAUDE.local.md` at repo root (and nested
   dirs). Plain markdown, optional YAML frontmatter (`title`/`description`). Monolithic →
   **chunk by H2** (§5). `[V]` for `CLAUDE.md` shape (this repo's root file).
2. **User instructions** — `~/.claude/CLAUDE.md` (global). Same format; `[V]` exists
   (empty file here: `/home/qp/.claude/CLAUDE.md`).
3. **Auto-memory** — `~/.claude/projects/<project-slug>/memory/`. `[V]`:
   - `MEMORY.md` — an **index**, not a fact. Lines: `- [Title] → filename.md — description`.
     Used to discover fact files + their human titles; **not itself imported as a memory**.
   - Per-fact files `*.md` (e.g. `feedback-worktree.md`) with **YAML frontmatter**:
     ```yaml
     name: feedback-worktree
     description: <one-line summary>
     metadata:
       node_type: memory
       type: feedback # or 'project'
       originSessionId: <uuid>
     ```
     Body is markdown containing `[[wikilink]]` cross-references
     (e.g. `Related: [[feedback-comprehensive-tests]]`, `See also [[feedback-worktree]]`).

**Mapping (auto-memory fact):** `content` = fact body (frontmatter stripped);
`tags` = `['claude-code', metadata.type]` (e.g. `feedback`/`project`); `metadata` carries
provenance (§4) + preserved `{ name, description, node_type, originSessionId }`;
`sourceKey` = `claude-code:<relative-path-under-memory-dir>` (e.g.
`claude-code:memory/feedback-worktree.md`); **1 fact file = 1 memory** (already atomic).
Wikilink target `[[feedback-worktree]]` → `slug:feedback-worktree` (matches the fact
whose filename stem / frontmatter `name` = `feedback-worktree`).

**Mapping (CLAUDE.md):** chunk by H2 → one memory per section; `tags=['claude-code',
'instructions']`; `sourceKey = claude-code:<path>#<section-slug>`.

### 3.2 GitHub Copilot `[V]`

Samples: `/home/qp/Cloud/Projects/engram/.github/copilot-instructions.md` (repo-wide),
`/home/qp/Cloud/Projects/saigo/saigo.web/.github/instructions/backlog-markdown-schema.instructions.md`
(scoped, with frontmatter), `.../openclaw/.github/instructions/copilot.instructions.md`.

- **`.github/copilot-instructions.md`** — single repo-wide file. Plain markdown; may carry
  YAML frontmatter (`title`/`description` seen in the engram sample). Relative md links to
  `AGENTS.md`/`README.md`. Monolithic → **chunk by H2**. `[V]`
- **`.github/instructions/*.instructions.md`** — path-scoped instruction files with YAML
  frontmatter: `description` (string), `name` (string), and **`applyTo`** — a **glob**
  (e.g. `"issues/**/*.md"`) selecting which files the instruction governs. `[V]` (saigo
  sample). Note: some files use `applyTo`, engram `.copilot-tracking/*.instructions.md`
  used `applyTo` differently and some had no frontmatter — treat frontmatter as optional
  and tolerate missing fields.

**Mapping:** `content` = section/body; `tags=['copilot','instructions']` (+ derive a tag
from `applyTo` if present); `metadata` preserves `{ description, name, applyTo }`;
`sourceKey = copilot:<path>[#<section-slug>]`. Focused `.instructions.md` files default to
**1 file = 1 memory** unless >2KB with multiple H2s (then split).

### 3.3 Cursor `[V]`

Sample: `/home/qp/Cloud/Projects/context-mem/configs/cursor/context-mem.mdc`.

- **`.cursor/rules/*.mdc`** — Cursor "project rules". **MDC frontmatter**:
  ```
  ---
  description: <string>     # when the rule applies (used by "agent-requested" rules)
  globs:                    # comma-separated or list of globs; empty in the sample
  alwaysApply: true         # boolean
  ---
  ```
  `[V]` for the three keys. Rule-activation semantics (Always / Auto-Attached via `globs`
  / Agent-Requested via `description` / Manual) are **`[A]`** — verify in T8. Body is plain
  markdown; may contain `[[wikilinks]]`, relative md links, or `@file` references `[A]`.
- **`.cursorrules`** (legacy, repo root) — a single plain-text/markdown file, **no
  frontmatter**. `[A]` (no live sample found). Monolithic → chunk by H2.

**Mapping:** `content` = rule body (MDC frontmatter stripped); `tags=['cursor','rules']`;
`metadata` preserves `{ description, globs, alwaysApply }`; `sourceKey =
cursor:<path>[#<section-slug>]`. `.mdc` default = **1 file = 1 memory**.

### 3.4 OpenAI Codex `[V]` partial

Sample: `/home/qp/Cloud/Projects/engram/AGENTS.md` (`[V]`); `~/.codex/AGENTS.md` **absent**
here, `~/.codex/memories/` **empty** (`[V]` that they can be empty).

- **`AGENTS.md` hierarchy** — Codex reads `AGENTS.md` files, merged by precedence:
  `~/.codex/AGENTS.md` (global) → repo-root `AGENTS.md` → nested-dir `AGENTS.md`
  (more-specific wins/appends). Precedence + merge semantics = **`[A]`** — verify in T9.
  Format is plain markdown, optional `title`/`description` frontmatter (`[V]` engram root
  AGENTS.md has both). Relative md links (`[README.md] → README.md`) `[V]`.
- Note: `AGENTS.md` is **shared** with Gemini/others as a de-facto standard; the Codex
  adapter and a generic AGENTS.md handling should not double-import the same file — the
  CLI/tool takes an explicit `source` so the operator picks one adapter per path.

**Mapping:** monolithic → **chunk by H2**; `tags=['codex','agents-md','instructions']`;
`sourceKey = codex:<path>#<section-slug>`; record hierarchy level in metadata (`global`
vs `repo`).

### 3.5 Gemini `[V]`

Samples: `/home/qp/Cloud/Projects/context-mem/configs/{antigravity,gemini-cli}/GEMINI.md`.

- **`GEMINI.md` hierarchy** — `~/.gemini/GEMINI.md` (global) → repo `GEMINI.md` → nested.
  `[V]` for the file format (plain markdown, **no frontmatter** in samples). Hierarchy
  precedence = **`[A]`** — verify in T10. Supports `@import`/`@file` include directives in
  some Gemini CLI versions = **`[A]`**.

**Mapping:** monolithic → **chunk by H2**; `tags=['gemini','instructions']`;
`sourceKey = gemini:<path>#<section-slug>`.

### 3.6 Generic markdown / Obsidian vault `[V]` (Claude auto-memory is the exemplar)

- A folder of `.md` files, optional YAML frontmatter, `[[wikilinks]]` and/or relative md
  links, optionally an index/MOC file. `[V]` (Claude auto-memory + saigo backlog samples).

**Mapping:** **1 file = 1 memory** by default; `--split-headings` opt-in for H2 splitting;
`tags=['markdown', ...frontmatter-derived]`; preserve all `[[wikilinks]]` + relative links;
`sourceKey = markdown:<relative-path>`. Frontmatter preserved verbatim in `metadata.frontmatter`.

### 3.7 Field-mapping summary

| Source              | File(s)                                             | Frontmatter keys                                             | Link syntax               | Chunking default      | sourceKey                    |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------ | ------------------------- | --------------------- | ---------------------------- |
| Claude auto-memory  | `memory/*.md` (+`MEMORY.md` index)                  | `name,description,metadata.{node_type,type,originSessionId}` | `[[wikilink]]`            | 1 file = 1 memory     | `claude-code:memory/<file>`  |
| Claude instructions | `CLAUDE.md`,`CLAUDE.local.md`,`~/.claude/CLAUDE.md` | `title,description` (opt)                                    | relative md               | H2 split              | `claude-code:<path>#<slug>`  |
| Copilot repo        | `.github/copilot-instructions.md`                   | `title,description` (opt)                                    | relative md               | H2 split              | `copilot:<path>#<slug>`      |
| Copilot scoped      | `.github/instructions/*.instructions.md`            | `description,name,applyTo(glob)`                             | relative md               | 1 file (split if big) | `copilot:<path>[#slug]`      |
| Cursor rules        | `.cursor/rules/*.mdc`                               | `description,globs,alwaysApply`                              | `[[..]]`/relative/`@file` | 1 file = 1 memory     | `cursor:<path>`              |
| Cursor legacy       | `.cursorrules`                                      | none                                                         | relative md               | H2 split              | `cursor:.cursorrules#<slug>` |
| Codex               | `AGENTS.md` (global+repo+nested)                    | `title,description` (opt)                                    | relative md               | H2 split              | `codex:<path>#<slug>`        |
| Gemini              | `GEMINI.md` (global+repo+nested)                    | none (usually)                                               | relative md/`@import`     | H2 split              | `gemini:<path>#<slug>`       |
| Generic             | `<vault>/**/*.md`                                   | any                                                          | `[[..]]`/relative         | 1 file = 1 memory     | `markdown:<relpath>`         |

---

## 4. Goals / Non-goals

**Goals**

- One adapter per source tool, each producing a common IR `{ facts[], links[], provenance }`.
- Preserve inter-memory links (wikilinks + relative md links) as first-class `MemoryLink`
  rows, including **deferred resolution** when a target is imported in a later run.
- Idempotent, re-runnable imports (content-hash + source-key ledger; update-on-drift).
- Secret/PII scan + redaction before any external embedding (closes G2).
- Bulk-embedding cost control incl. dry-run cost estimate + `disabled`-provider path (G7).
- Delivery via CLI (`engram import`), MCP tool (`import_agent_memory`), and dry-run mode.
- Per-item failure isolation; Postgres remains source of truth.

**Non-goals**

- Importing into STM (all imports → LTM; §5).
- Writing back / two-way sync to the source tools (WP3 export is the outbound side).
- Semantic de-duplication changes — reuse the existing dup/contradiction services as-is.
- Auth/tenancy redesign (G1) — imports run admin-gated with an explicit `userId`.
- A live file watcher — import is an explicit, invoked operation.
- Full Obsidian feature parity (embeds `![[..]]`, block refs `^id`, callouts) — best-effort,
  parsed as plain content; only note-level `[[..]]` links become `MemoryLink` rows.

---

## 5. Design decisions

**D1 — Dedicated import path wrapping `create()`, plus a source ledger.** Import does **not**
reimplement dedup/embedding. `MemoryImportService` computes `sourceKey` + `contentHash`,
consults the **import ledger** (D3), then:

- ledger hit, hash unchanged → **skip** (idempotent no-op; count as `skipped`).
- ledger hit, hash changed → **update** the mapped memory via `MemoryLtmService.update()`
  (re-embeds, merges metadata); count `updated`.
- ledger miss → call `MemoryLtmService.create()`. Because `create()` **already returns an
  existing row on exact-content match** (`memory-ltm.service.ts:139-148`), a brand-new
  `sourceKey` whose content duplicates an existing memory **in the same `scope`** resolves
  to that existing memory. In that case the ledger records `sourceKey → existingMemoryId`
  and provenance becomes **multi-source**: append this source to a
  `metadata.provenance.sources[]` array rather than overwriting. Count `created` (new row)
  vs `mergedIntoExisting`.

**Scope caveat (critical, ties to D4):** `create()`'s exact-dedup is **scope-bound**
(`findExactDuplicate` uses `scope ?? null`, `memory-ltm.service.ts:1449`). Therefore
content-merge only happens **among memories that share the import scope** (default
`import`). A pre-existing _manual_ memory (created via `create_memory`, typically
`scope=null` or `project:x`) will **not** be found or merged by a default `import` run — the
importer will create a new row. If the operator explicitly wants to dedup an import against
existing memories, they must import with a matching `--scope`. This composition is the heart
of "re-run must not duplicate" **within an import namespace**: `create()` dedupes _content_
per scope; the ledger dedupes _source identity_; together they are convergent for repeated
imports of the same sources.

**D2 — `MemoryLink` is the first-class link store; existing metadata annotations coexist.**
SHARED-1 adds a `MemoryLink` table (§6). It **does not replace** the existing
`duplicateOf`/`supersededBy` metadata annotations written by `create()` — those keep
working untouched. WP4 writes _explicit_ links (wikilink/relative/frontmatter refs) as
`MemoryLink` rows with a `type` (`references` default). Reconciling metadata annotations →
`MemoryLink` (and the WP3 export contract) is **T15** (do not silently change create()).

**D3 — Idempotency needs an indexed lookup → a dedicated `MemoryImportSource` ledger table**
(§6), **not** a JSON-metadata scan (`metadata` is unindexed). Unique on
`(userId, sourceKey)`; stores `memoryId`, `sourceTool`, `sourcePath`, `contentHash`,
`importBatchId`, `importedAt`. This makes "have I imported X?" an indexed point-lookup and
carries the hash for drift detection.

**D4 — Import scope = a single `import` namespace by default (configurable via `--scope`).**
Rationale: dedup and link resolution interact with `scope`. `findExactDuplicate`/
`findDuplicate` are **scope-bound** (`scope ?? null`). Putting all imports in one namespace
(default literal `import`, override with `--scope project:<slug>`) means: (a) dedup collapses
identical content **across tools** within the import namespace (good for round-trip &
re-runs); (b) links resolve across all imported sources in that namespace. Provenance
records the specific tool, so a per-tool view is still available via `metadata`/ledger.
**Link resolution is scoped to `userId`, not to `scope`** (a Claude fact may link a Cursor
rule) — the resolver queries the ledger by `userId`, independent of the dedup scope. State
this asymmetry in T5. (Trade-off: two genuinely different facts with byte-identical content
across tools collapse into one multi-source memory — acceptable and usually desirable.)

**D5 — All imports → LTM (`type: 'long-term'`, `expiresAt: null`).** Instruction/agent
memory is durable knowledge, not ephemeral session state. STM lives in Redis with a TTL,
is not the source of truth, and has no link model. Non-goal: importing to STM.

**D6 — Chunking rule (concrete).**

- **Atomic fact files** (Claude auto-memory `*.md`, focused Cursor `.mdc`, focused
  `*.instructions.md`): **1 file = 1 memory**. Exception: if the file has ≥2 H2 sections
  **and** exceeds 2,048 chars, apply the H2 split below.
- **Monolithic instruction files** (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  `copilot-instructions.md`, `.cursorrules`): **split at H2 (`##`) boundaries.** Each H2
  section + its H3+ children → one memory. Preamble before the first H2 → one `overview`
  memory. A section < 200 chars merges **into the following** section to avoid fragment
  memories. A section > `INGEST_CHUNK_CHAR_LIMIT` (10,240) is further split with
  `splitTurnsToChunks`-style paragraph splitting, anchors suffixed `#<slug>-part-2`, etc.
- **Generic markdown/vault**: 1 file = 1 memory; `--split-headings` opts into H2 split.
- **Index/MOC files** (Claude `MEMORY.md`): parsed for discovery + titles, **not imported**.
- `sourceKey` carries the section slug (`#<slug>`) so chunks are individually addressable
  and re-runs update the right chunk.

**D7 — Secret/PII scanning is a first-class pipeline stage with a policy, before embedding.**
Reuse `PrivacyFilterStep`'s 9 patterns (`privacy-filter.step.ts:10`) via a shared scanner;
T4 extends it (JWTs, Slack tokens, `.env` `KEY=VALUE`, private IPs, internal hostnames).
Import differs from `create()`'s silent redaction — it exposes a **`--secrets` policy**:
`redact` (default: replace + record), `flag` (keep but set `metadata.embeddingExcluded=true`
so the raw text is never sent to an external provider, and tag `has-secret`), `skip` (drop
the whole file, count `skipped`), `fail` (abort the run). Dry-run **lists files + matched
pattern names** without persisting. When any secret is detected and the provider is external
(`openai`), the redacted text is what gets embedded; `flag` mode additionally suppresses
embedding entirely. Closes G2.

**D8 — Embedding on import is null-safe & cost-controlled.** `create()`/`update()` embed
inline and tolerate `null`. For bulk first imports: `EMBEDDING_PROVIDER=disabled` ⇒ store
with empty `embedding[]`, **zero external calls**; the summary advises running
`pnpm --filter mcp-server reindex` afterward (cursor-resumable) once a provider is set.
Dry-run reports an **embedding cost estimate**: `newFacts × est-tokens (≈chars/4) ×
model-rate`. T14 optionally adds `EmbeddingsService.generateMany()` batching (G7); import
works without it (per-fact `generate`).

**D9 — Delivery: CLI + admin MCP tool + dry-run.**

- CLI `import.cli.ts` (mirrors `reindex.cli.ts`): `pnpm --filter mcp-server import --
  <source> <path> [--user <id>] [--scope <s>] [--dry-run] [--secrets=redact|flag|skip|fail]
  [--no-embed] [--split-headings]`.
- MCP tool `import_agent_memory` (`auth: 'admin'`, `assertAdminAuthorized`): reads a
  **server-side** path + bulk-writes, so admin-gated. Params include `source`, `path`,
  `dryRun`, `scope`, `secretsPolicy`. Register in `getMcpTools()`.
- **Dry-run** performs parse → redact-scan → dedup/ledger simulation → link-resolution
  simulation, returns `{parsed, newFacts, updates, skips, mergedIntoExisting,
links:{resolved,deferred,dangling}, secrets:[{path,patterns}], embeddingCostEstimate,
quotaHeadroom}` and **writes nothing**.

**D10 — Error handling per repo convention.** Per-fact parse/persist/link failures are
counted and skipped (like `reindex`'s `{processed,skipped,failed}`); Postgres is the source
of truth; vector-index and link failures are non-fatal. `LtmMemoryQuotaExceededError` (D-risk)
stops the run **gracefully** with a partial summary + a resumable `cursor` (last fact index),
rather than crashing.

---

## 6. Schema changes

Two new tables + one column. Apply as **one migration** (schema migrations run serially
across the suite — coordinate with WP2/WP3 per `../README.md`). Use `pnpm db:migrate`
(never hand-edit generated SQL); Prisma client via `pnpm db:generate`.

### SHARED-1 — `MemoryLink` schema + migration (shared prerequisite with WP3)

> **Superseded:** WP3 and WP4 drafted divergent `MemoryLink` models. Implement the
> reconciled canonical model in [`../SHARED-1-memory-link.md`](../SHARED-1-memory-link.md)
> instead of the draft below (kept for rationale — its nullable target + locator
> survive into the canonical model).

Absent today (verified: no relationship model in `prisma/schema.prisma`). WP3 (export) and
WP4 (import) both need it (G6). Define once here; WP3 consumes the same model.

```prisma
model MemoryLink {
  id             String   @id @default(cuid(2))
  userId         String
  organizationId String?
  sourceMemoryId String                     // the memory that contains the link
  targetMemoryId String?                    // NULL while unresolved (deferred/dangling)
  targetLocator  String                     // normalized locator: 'slug:x' | 'path:...#a'
  type           String   @default("references") // references|related|supersedes|duplicate|...
  metadata       Json?                      // { rawTarget, kind, sourceTool, importBatchId }
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  source User @relation("MemoryLinkUser", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([sourceMemoryId, targetLocator, type]) // idempotent link upsert
  @@index([userId, targetLocator])                // deferred-resolution scan
  @@index([targetMemoryId])
  @@index([sourceMemoryId])
  @@map("memory_links")
}
```

Notes: `targetMemoryId` nullable so **dangling/deferred** links persist and can be filled on
a later import (T5). `Memory` rows are **not** FK-referenced by memory id (they're cuid2
strings on the same `Memory` model); enforce referential cleanup in application code
(delete links when a memory is deleted) to avoid a self-relation migration churn — document
this in SHARED-1. Add the reciprocal relation field to `Memory`/`User` as needed to satisfy
Prisma. **Coordinate the exact relation wiring with WP3** (T15) so both sides agree.

### T2-schema — `MemoryImportSource` ledger (idempotency; WP4-local)

```prisma
model MemoryImportSource {
  id            String   @id @default(cuid(2))
  userId        String
  memoryId      String                        // resolved target memory
  sourceTool    String                        // 'claude-code'|'copilot'|'cursor'|'codex'|'gemini'|'markdown'
  sourcePath    String
  sourceKey     String                        // e.g. 'claude-code:memory/feedback-worktree.md'
  contentHash   String                        // sha256(trim().toLowerCase()) — reuse computeHash()
  importBatchId String
  importedAt    DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, sourceKey])               // indexed idempotency point-lookup
  @@index([userId, contentHash])
  @@index([memoryId])
  @@map("memory_import_sources")
}
```

### Optional column (defer unless needed)

A `Memory.contentHash String?` column would speed cross-source content dedup, but the
ledger already stores the hash and `create()` already does exact-content dedup by string.
**Do not add** unless T3 profiling shows the string-equality dedup is a bottleneck; record
as a follow-up.

---

## 7. Work breakdown

New home for shared import logic: **`packages/memory-import`** (new workspace package
`@engram/memory-import`, NestJS module `MemoryImportModule`) — per repo convention, shared
behavior lives in `packages/*`; the app (`apps/mcp-server`) only wires the CLI + MCP tool.
Model the package structure on `packages/memory-ltm` (module + service + `index.ts` barrel).
Every task: strict TypeScript (no unjustified `any`), Zod `.strict()` on any tool/DTO input,
tests at **both** service and wiring level, conventional commit `feat(import): … (#<issue>)`.

Sizes: **S** ≤ ½ day, **M** ~1–2 days, **L** ~3+ days.

---

### SHARED-1 — `MemoryLink` schema + migration · size M · depends: none

**Goal:** first-class relationship table (§6) shared with WP3.

> **WP4 owns this (WP3 deferred it).** WP3's export already _reads_ `MemoryLink` rows
> additively through the `loadMemoryLinks` seam in `MemoryExportService` — a no-op until this
> table exists. Landing SHARED-1 here makes WP3's export emit first-class `MemoryLink` edges
> with **no WP3 code change**. Implement the **reconciled canonical model** in
> [`../SHARED-1-memory-link.md`](../SHARED-1-memory-link.md) (it supersedes the §6 draft below —
> notably it _does_ FK to `Memory`: source `Cascade`, target `SetNull`). Flip the SHARED-1 row
> in the suite [`STATE.md`](../STATE.md) to ✅ when done.
> **Paths:** `prisma/schema.prisma` (add `MemoryLink`, reciprocal relation fields on `User`);
> `prisma/migrations/*` (generated). Optionally add a tiny `packages/memory-ltm` helper to
> delete links on memory delete.
> **Steps:**

1. Add the `MemoryLink` model exactly as §6. Add the reciprocal `MemoryLink[]` relation
   field to `User` (name `"MemoryLinkUser"`). Do **not** FK `sourceMemoryId`/
   `targetMemoryId` to `Memory` (keep them plain cuid2 strings; app-level cleanup).
2. `pnpm db:generate` then `pnpm db:migrate` (dev migration named `add_memory_link`).
3. Add `deleteLinksForMemory(memoryId)` cleanup hook wherever a memory is hard-deleted
   (`MemoryLtmService.delete()` at `memory-ltm.service.ts:422`) — non-fatal, best-effort.
   **Acceptance:** migration applies on a clean DB (`pnpm db:reset`); `MemoryLink` rows
   insertable with `targetMemoryId = null`; unique constraint rejects duplicate
   `(sourceMemoryId, targetLocator, type)`; deleting a memory removes its outbound links.
   **Tests:** _service_ — a spec that inserts/updates/deletes `MemoryLink` incl. a null-target
   row and the unique-constraint conflict path. _wiring_ — extend
   `memory-ltm.service.spec.ts` to assert `delete()` also removes links (feature-present) and
   is a no-op when no links exist (feature-absent).
   **Note:** coordinate the relation-field naming/back-reference with WP3 before merging (G6).

---

### T1 — Import IR + `SourceAdapter` interface + shared markdown parse utils · M · depends: none

**Goal:** the common contract every adapter targets, plus reusable frontmatter/link parsing.
**Paths (new):** `packages/memory-import/package.json`, `tsconfig.json`,
`src/index.ts`, `src/memory-import.module.ts`, `src/ir/types.ts`,
`src/ir/source-adapter.interface.ts`, `src/parse/frontmatter.ts`, `src/parse/links.ts`,
`src/parse/chunk.ts`, + specs.
**Steps:**

1. Scaffold the package (copy `packages/memory-ltm/{package.json,tsconfig.json}` shape;
   add to root `pnpm-workspace.yaml` **only if not glob-covered** — do NOT regenerate
   `pnpm-lock.yaml`; hand-add the importer entry per `project-engram-tooling-gotchas`).
2. Define the IR in `ir/types.ts`:
   ```ts
   export type SourceTool = 'claude-code' | 'copilot' | 'cursor' | 'codex' | 'gemini' | 'markdown';
   export interface ImportedLink {
     kind: 'wikilink' | 'md-relative' | 'frontmatter-ref';
     rawTarget: string;
     targetLocator: string;
     type: string;
   }
   export interface ImportedFact {
     localId: string;
     sourceKey: string;
     sourceTool: SourceTool;
     sourcePath: string;
     anchor?: string;
     title?: string;
     content: string;
     tags: string[];
     frontmatter?: Record<string, unknown>;
     links: ImportedLink[];
   }
   export interface ProvenanceCommon {
     importedAt: string;
     importBatchId: string;
     host?: string;
     adapterVersion: string;
   }
   export interface ImportIR {
     sourceTool: SourceTool;
     rootPath: string;
     facts: ImportedFact[];
     provenance: ProvenanceCommon;
   }
   ```
3. `source-adapter.interface.ts`: `interface SourceAdapter { readonly tool:SourceTool;
detect(path:string):Promise<boolean>; parse(path:string, opts:ParseOptions):Promise<ImportIR>; }`
   `parse` is filesystem-in, IR-out — **no DB access** (keeps adapters unit-testable in
   isolation, satisfies "one task per adapter, parallelizable").
4. `parse/frontmatter.ts`: parse YAML frontmatter (dependency check: reuse an existing YAML
   dep if the repo already has one — grep `js-yaml`/`yaml` in the lockfile; else a minimal
   parser). Return `{ frontmatter, body }`.
5. `parse/links.ts`: extract `[[wikilink]]` / `[[a|b]]` / `[[a#h]]` and
   `[text] → rel.md` links; normalize to `targetLocator` (`slug:<stem>` for wikilinks;
   `path:<repo-relative-normalized>[#anchor]` for md links, resolved against the containing
   file's dir). Ignore external `http(s)://`, anchors-only `#x`, and image embeds `![...]`.
6. `parse/chunk.ts`: implement D6's H2-splitting rule; reuse `INGEST_CHUNK_CHAR_LIMIT` +
   a `splitTurnsToChunks`-equivalent for >10KB sections (import the constant or re-declare
   with a comment pointing at `conversation-chunking.ts`). Emit section slug + anchor.
   **Acceptance:** given fixture markdown, `parse/links` returns the exact locators for both
   syntaxes incl. alias/heading forms; `parse/chunk` splits a multi-H2 doc into N section
   facts, merges a <200-char section forward, and hard-splits a >10KB section with `-part-N`
   anchors; frontmatter parser tolerates missing/empty frontmatter.
   **Tests:** _service/unit_ — table-driven specs for `frontmatter`, `links`, `chunk` with
   fixtures covering every §3 link/frontmatter form. (No wiring level yet — pure utils; wiring
   is exercised by T3.)

---

### T2 — `MemoryImportSource` ledger schema + migration · S/M · depends: none (serialize w/ SHARED-1)

**Goal:** indexed idempotency ledger (§6, D3).
**Paths:** `prisma/schema.prisma` (add `MemoryImportSource`), migration; a thin
`packages/memory-import/src/ledger/import-ledger.service.ts` (Nest injectable wrapping
Prisma) with `find(userId,sourceKey)`, `upsert(entry)`, `findByContentHash`,
`listBatch(importBatchId)`.
**Steps:** add model per §6; `pnpm db:generate` + `pnpm db:migrate` (name
`add_memory_import_source`); implement the service; export from the package barrel.
**Acceptance:** unique `(userId, sourceKey)` enforced; `upsert` updates `contentHash` +
`memoryId` on re-import; `find` is a single indexed query.
**Tests:** _service_ — insert/find/upsert incl. the unique-conflict update path and a
hash-drift update. _wiring_ — covered in T3 (ledger used by the pipeline).
**Coordination:** land this migration **after** SHARED-1 (schema migrations serial).

---

### T3 — `MemoryImportService` core pipeline (orchestration) · L · depends: T1, T2, SHARED-1

**Goal:** the engine that turns an `ImportIR` into persisted memories + links, idempotently.
**Paths:** `packages/memory-import/src/memory-import.service.ts` (+ spec);
`memory-import.module.ts` wires it with `MemoryLtmService`, `ImportLedgerService`,
`SecretScanner` (T4), `LinkResolver` (T5), and the adapter registry.
**Steps:**

1. `run(input: ImportRunInput): Promise<ImportSummary>` where `ImportRunInput =
{ source, path, userId, scope='import', secretsPolicy='redact', embed=true,
  dryRun=false, splitHeadings=false }`.
2. Resolve the adapter from `source` (registry keyed by `SourceTool`); `adapter.parse()` → IR.
3. For each fact: **secret scan** (T4) per `secretsPolicy` → possibly redacted content,
   `embeddingExcluded` flag, or file-skip.
4. Compute `contentHash = sha256(content.trim().toLowerCase())` (reuse the pattern from
   `ingest-pipeline.service.ts:111`). Ledger lookup by `(userId, sourceKey)` → apply D1
   (skip / update / create / merge-into-existing). Build `localId → memoryId` map.
5. Persist via `MemoryLtmService.create()`/`update()` with `type:'long-term'`,
   `scope`, `tags`, and `metadata.provenance` (§4: `{ sourceTool, sourcePath, sourceKey,
importedAt, importBatchId, contentHash, sources:[…] }` + preserved frontmatter). When
   `embeddingExcluded`, import runs the persist with the provider effectively bypassed
   (see T14 — pass a flag or set `EMBEDDING_PROVIDER` expectation; simplest: store then let
   reindex fill later, and never send flagged text to an external provider).
6. Hand all facts + resolved `localId→memoryId` map to **LinkResolver** (T5) for the
   two-pass link + deferred resolution. **T3 defines the `LinkResolver` injection interface
   and the call site; a no-op stub implementation (returns zero resolved/deferred/dangling)
   is acceptable until T5 lands** — this keeps T3 and T5 independently executable.
7. Catch `LtmMemoryQuotaExceededError` → stop gracefully, return partial summary with a
   resumable cursor (index of the last processed fact). All other per-fact errors →
   `failed++`, continue (Postgres source of truth).
8. `dryRun` → run steps 2–4 + link **simulation** only; **persist nothing**; return the
   estimate summary (D9).
   **Acceptance:** re-running the same import is a no-op (`created=0, skipped=all`); editing a
   source file then re-importing yields `updated=1`; a byte-identical fact from a second source
   yields `mergedIntoExisting` + multi-source provenance; quota-exceeded returns a partial
   summary (no crash); `dryRun` writes zero rows (assert DB unchanged).
   **Tests:** _service_ — full pipeline over a fixtures dir with a fake/in-memory
   `MemoryLtmService` and real ledger: happy path, re-run idempotency, drift-update,
   cross-source merge, secret-skip, quota-stop, dry-run-writes-nothing. _wiring_ — a spec that
   constructs the real `MemoryImportModule` DI graph and asserts `create()`/`update()` are
   invoked with the expected args (spy), and that with `MemoryLtmService` absent/degraded the
   run still records ledger + summary without throwing.

---

### T4 — Secret / PII scan + redaction stage · M · depends: T1

**Goal:** the D7 policy stage; **no raw secret ever reaches an external embedding provider.**
**Paths:** `packages/memory-import/src/secrets/secret-scanner.ts` (+ spec). Import the 9
patterns from `packages/memory-ltm/src/ingest/privacy-filter.step.ts:10-32` (extract them to
a shared const if cheap, else re-declare with a comment cross-ref) and **extend**: JWTs
(`eyJ…`), Slack tokens (`xox[bap]-…`), `.env` `KEY=VALUE` secret-ish lines, private IPv4
ranges, obvious internal hostnames.
**Steps:** `scan(content): { redacted, matches: {pattern, count}[], hasSecret }`;
`apply(fact, policy)` implements `redact|flag|skip|fail` (D7); `flag` sets
`fact.frontmatter`/metadata `embeddingExcluded=true` + adds tag `has-secret`; dry-run path
returns matches without mutating.
**Acceptance:** each pattern matches its fixture + does not match a benign near-miss;
`fail` throws a typed `ImportSecretPolicyError`; `skip` drops the fact; `redact` replaces
with `[REDACTED]` and records the pattern; `flag` leaves content but marks
`embeddingExcluded`.
**Tests:** _service_ — per-pattern positive/negative fixtures + one fixture per policy mode.
_wiring_ — assert T3 honors each policy (skip decrements persisted count; flag suppresses
external embedding; fail aborts with partial summary).

---

### T5 — Link-resolution engine (two-pass + deferred) · L · depends: SHARED-1, T1, T3

**Goal:** turn `ImportedLink`s into `MemoryLink` rows, resolving targets even across runs.
**Paths:** `packages/memory-import/src/links/link-resolver.service.ts` (+ spec).
**Steps:**

1. **Pass A (intra-batch):** build a locator index from all facts in the current IR
   (`slug:<stem>` from filename/`frontmatter.name`; `path:<normalized>` from `sourcePath`).
   Resolve links whose target is in the same batch → `targetMemoryId` from the
   `localId→memoryId` map (T3 step 4).
2. **Pass B (cross-run):** for still-unresolved locators, query the **ledger** (T2) by
   `userId` (D4: link resolution is `userId`-scoped, **not** `scope`-scoped) —
   `slug:` matches a ledger `sourceKey` ending in `/<stem>.md`; `path:` matches
   `sourcePath`. Resolve to the ledger's `memoryId`.
3. **Deferred:** locators still unresolved → upsert a `MemoryLink` with
   `targetMemoryId=null` + `targetLocator` (idempotent via the unique index).
4. **Resolve-on-later-import:** after every import batch persists, run
   `resolveDeferred(userId)` — scan `memory_links WHERE targetMemoryId IS NULL AND userId=…`
   and fill any whose `targetLocator` now matches a freshly-imported memory (index on
   `(userId, targetLocator)`). This is what makes "targets imported later" work.
5. **Dangling policy:** links that never resolve stay as null-target rows (queryable,
   reported in the summary as `dangling`); a `--prune-dangling` maintenance flag can delete
   them. Never fabricate a target memory.
   **Acceptance:** A links B in the same batch → resolved; A imported before B (separate runs)
   → A's link is deferred then auto-resolved when B imports; a link to a never-present target
   stays dangling and is counted; re-running does not duplicate links (unique upsert).
   **Tests:** _service_ — intra-batch resolve, cross-run deferred→resolved, dangling stays,
   idempotent re-run, alias/heading wikilink normalization. _wiring_ — T3 invokes the resolver
   and the summary link counts match; assert `resolveDeferred` fills a prior null-target row on
   the second import.

---

### T6 — Adapter: **Claude Code** · M · depends: T1

**Goal:** parse project/user `CLAUDE.md` + auto-memory dir → IR. Format = §3.1 (`[V]`).
**Paths:** `packages/memory-import/src/adapters/claude-code.adapter.ts` (+ spec);
fixtures under `src/adapters/__fixtures__/claude-code/` (copy shape from the real sample —
do **not** import qp's live memory into fixtures; craft representative synthetic files).
**Steps:** detect `memory/MEMORY.md` (auto-memory) vs a bare `CLAUDE.md`; for auto-memory,
read `MEMORY.md` for titles then each `*.md` fact (frontmatter `name/description/metadata`,
body, `[[wikilinks]]`) → 1 fact each, `MEMORY.md` **excluded**; for `CLAUDE.md`, H2-chunk.
Map fields per §3.1. `Verify` step: none needed (format `[V]`) — but re-read the live sample
dir read-only to confirm frontmatter keys before finalizing.
**Acceptance:** auto-memory dir → N facts (N = fact files, index excluded), each with the
right tags/provenance and its wikilinks as `ImportedLink`s; `CLAUDE.md` → per-section facts.
**Tests:** _service_ — fixture dir → expected IR (facts count, tags, links). _wiring_ — via
T3, a fixture import produces the expected memories + links end-to-end.

---

### T7 — Adapter: **GitHub Copilot** · S/M · depends: T1

**Goal:** parse `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`.
Format = §3.2 (`[V]`).
**Paths:** `src/adapters/copilot.adapter.ts` (+ spec, fixtures).
**Steps:** repo-wide file → H2-chunk; scoped `*.instructions.md` → 1 fact (split if >2KB),
preserve `description/name/applyTo` in metadata, derive a tag from `applyTo`. Relative md
links → `ImportedLink`s.
**Acceptance / Tests:** as T6 shape (service: fixture→IR; wiring: via T3). Fixtures cover a
file **with** frontmatter and one **without** (both seen in real samples).

---

### T8 — Adapter: **Cursor** · M · depends: T1

**Goal:** parse `.cursor/rules/*.mdc` + legacy `.cursorrules`. Format = §3.3 (frontmatter
keys `[V]`; activation semantics + `@file`/`.cursorrules` = `[A]`).
**Paths:** `src/adapters/cursor.adapter.ts` (+ spec, fixtures).
**Steps:** parse MDC frontmatter (`description/globs/alwaysApply`) — same YAML parser as T1;
`.mdc` → 1 fact (split if big); `.cursorrules` → H2-chunk. Preserve frontmatter in metadata;
derive tags from `globs`/`alwaysApply`. **`Verify` step (required):** confirm via
`WebFetch`/`WebSearch` the current `.mdc` frontmatter fields and whether `globs` is a list
vs comma-string, and whether Cursor supports `@file` refs — adjust the link extractor
accordingly; record findings in a code comment.
**Acceptance / Tests:** service fixture→IR (incl. empty `globs`, `alwaysApply:true` like the
real sample); wiring via T3.

---

### T9 — Adapter: **OpenAI Codex (AGENTS.md)** · S/M · depends: T1

**Goal:** parse the `AGENTS.md` hierarchy (`~/.codex/AGENTS.md` + repo + nested). Format =
§3.4 (repo file `[V]`; hierarchy precedence/merge = `[A]`).
**Paths:** `src/adapters/codex.adapter.ts` (+ spec, fixtures).
**Steps:** accept a repo root or explicit file; discover `AGENTS.md` at the given path (and
optionally `~/.codex/AGENTS.md` when `--include-global`); H2-chunk each; tag with hierarchy
level in metadata (`global`/`repo`/`nested`). **`Verify` step (required):** confirm the
`AGENTS.md` search order + whether Codex merges or overrides across levels (WebSearch the
AGENTS.md spec / Codex docs); document the resolved precedence in a comment. Avoid
double-import overlap with the generic adapter (operator picks `source=codex`).
**Acceptance / Tests:** service fixture (repo + nested AGENTS.md)→IR with correct
per-section facts + hierarchy tags; wiring via T3.

---

### T10 — Adapter: **Gemini (GEMINI.md)** · S/M · depends: T1

**Goal:** parse the `GEMINI.md` hierarchy. Format = §3.5 (file format `[V]`; hierarchy +
`@import` = `[A]`).
**Paths:** `src/adapters/gemini.adapter.ts` (+ spec, fixtures).
**Steps:** discover repo `GEMINI.md` (+ `~/.gemini/GEMINI.md` when `--include-global`);
H2-chunk; handle `@import`/`@file` includes if present (inline or link). **`Verify` step
(required):** confirm GEMINI.md precedence + whether `@import` directives exist in current
Gemini CLI; if includes exist, decide inline-vs-link and note it.
**Acceptance / Tests:** service fixture→IR; wiring via T3.

---

### T11 — Adapter: **Generic markdown / Obsidian vault** · M · depends: T1

**Goal:** import an arbitrary `.md` folder preserving `[[wikilinks]]` + relative links.
Format = §3.6 (`[V]`).
**Paths:** `src/adapters/markdown.adapter.ts` (+ spec, fixtures).
**Steps:** walk the folder for `*.md`; 1 file = 1 memory (or H2-split with
`--split-headings`); preserve all frontmatter in `metadata.frontmatter`; extract both link
syntaxes; optionally skip a designated index/MOC file by name. Best-effort on Obsidian-only
syntax (embeds/block-refs parsed as plain text — Non-goal §4).
**Acceptance / Tests:** service — a mini-vault fixture with cross-linked notes → IR whose
links form the expected graph; wiring via T3 produces `MemoryLink` rows matching the graph.

---

### T12 — CLI `engram import` · S/M · depends: T3

**Goal:** operator entry point mirroring the reindex CLI.
**Paths (new):** `apps/mcp-server/src/import.cli.ts`; `apps/mcp-server/package.json` add
`"import": "nest build && node dist/import.cli.js"` (mirror line 16). Wire
`MemoryImportModule` into `AppModule`.
**Steps:** copy `reindex.cli.ts:74-110` bootstrap; parse
`<source> <path> [--user] [--scope] [--dry-run] [--secrets=…] [--no-embed]
[--split-headings] [--include-global] [--prune-dangling]`; call
`memoryImportService.run(...)`; print the summary; `process.exitCode=1` when `failed>0` or a
policy `fail` aborted.
**Acceptance:** `pnpm --filter mcp-server import -- claude-code <path> --dry-run` prints a
summary and writes nothing; a real run imports + reports counts; bad `source` exits non-zero
with a clear message.
**Tests:** _service_ — `parseArgs` unit spec (mirror reindex CLI test style). _wiring_ — an
e2e-style spec booting an app context against a test DB that runs a dry-run import over a
fixtures dir and asserts the summary + zero writes.

---

### T13 — MCP tool `import_agent_memory` + dry-run · M · depends: T3

**Goal:** admin-gated MCP surface.
**Paths:** `apps/mcp-server/src/memory/dto/import-agent-memory.dto.ts` (Zod `.strict()`);
handler + registration in `apps/mcp-server/src/memory/memory.controller.ts` (`getMcpTools()`
at `:1076`, model on `reindexMemories()` `:452-492` incl. `assertAdminAuthorized`).
**Steps:** schema `{ adminToken, source, path, userId, scope?, dryRun?, secretsPolicy?,
embed? }.strict()`; handler asserts admin, calls `memoryImportService.run`, returns the
summary as MCP `content` JSON; add to the tool array with `auth:'admin'`; respect the
deployment-profile exclusion list pattern (`:1300+`) if imports should be hidden in some
profiles.
**Acceptance:** tool appears in `tools/list` (enterprise profile); missing/wrong
`adminToken` → `admin_auth_denied`; `dryRun:true` returns estimate + writes nothing.
**Tests:** _service_ — handler spec (admin accept/deny, dry-run). _wiring_ — a
`memory.controller.spec.ts` case asserting the tool is registered with `auth:'admin'` and
that dispatch validates the Zod schema (`.strict()` rejects extra keys).

---

### T14 — Bulk embedding cost control + dry-run estimator + disabled-provider path · M · depends: T3

**Goal:** make first bulk imports cheap and predictable (G7, D8).
**Paths:** `packages/memory-import/src/embedding/cost-estimator.ts` (+ spec); optional
`packages/embeddings/src/embeddings.service.ts` `generateMany(texts[])` batch method
(+ spec) — **optional**, import must work without it.
**Steps:** estimator: `estimate(facts, model) → { calls, approxTokens, approxUsd }`
(tokens ≈ chars/4; rate from the model config). Wire into dry-run summary (D9). Implement
the `--no-embed`/`EMBEDDING_PROVIDER=disabled` path: persist with empty `embedding[]`, emit
an advisory to run `pnpm --filter mcp-server reindex` (cursor-resumable). If `generateMany`
is added, batch new-fact embeddings and cache per existing SHA-256 key semantics.
**Acceptance:** dry-run shows a nonzero cost estimate for new facts and **$0 / 0 calls** when
provider is `disabled`; a disabled-provider import stores memories with empty embeddings and
the advisory appears; reindex afterward backfills vectors.
**Tests:** _service_ — estimator math; disabled path stores empty embeddings. _wiring_ — T3
run with a stub embeddings service asserts no external call in disabled mode; batch method
(if built) caches + de-dups identical texts.

---

### T15 — WP3 contract reconciliation + round-trip test · M · depends: T1, WP3 PLAN

**Goal:** one canonical frontmatter/link/`MemoryLink` contract for export (WP3) + import
(WP4); prevent drift (G6).
**Paths:** read `../WP3-markdown-export/PLAN.md`; if it defines a shared contract module
(e.g. `packages/memory-interchange`), consume it from the adapters/exporters instead of
duplicating; else propose the shared module and align field names (`node_type`, `type`,
wikilink slug rules, `MemoryLink.type` vocabulary).
**Steps:** diff WP3's frontmatter/link spec vs §3/§5 here; record deltas; extract the shared
schema; add a **round-trip test**: export N seeded memories (WP3) → import into a clean DB
(WP4) → assert memories + `MemoryLink` graph match (ids may differ; compare by content +
link topology).
**Acceptance:** a CI-able round-trip spec passes; both sides import the same contract module.
**Tests:** _wiring_ — the export→import round-trip e2e; _service_ — contract-schema unit
tests (frontmatter parse/serialize are inverse).
**Note:** WP3 is being written concurrently — if its PLAN is still a stub at execution time,
implement against §3/§5's contract here and leave a TODO + issue link for reconciliation.

---

### T16 — Docs: import guide + secrets policy + cost path · S · depends: T12, T13, T4, T14

**Goal:** operator + developer docs (align with WP6).
**Paths:** `docs/` (new `docs/IMPORT.md` or a section in `docs/SETUP.md`); update root
`README.md` if a new top-level command is introduced; ensure `pnpm docs:check` passes.
**Steps:** document each `source`, the CLI/MCP surfaces, the `--secrets` policy + G2
rationale, the "import cheap then reindex" cost path (G7), dangling-link behavior, and
idempotency semantics.
**Acceptance:** `pnpm docs:check` green; docs cover every adapter + flag.
**Tests:** docs lint (`pnpm docs:check`); no code tests.

---

## 8. Dependency graph

```
SHARED-1 (MemoryLink) ─┐
T2 (ledger schema) ────┼─► T3 (pipeline core) ─► T5 (link resolver)
T1 (IR + parse utils) ─┘        │  │  │
                                │  │  └────────► T12 (CLI) ─► T16 (docs)
T1 ─► T4 (secret scan) ─────────┘  ├────────────► T13 (MCP tool) ─► T16
                                   └────────────► T14 (embed cost) ─► T16

T1 ─► T6  Claude   ┐
T1 ─► T7  Copilot  │  (six adapters — fully parallel, depend only on T1;
T1 ─► T8  Cursor   ├── each has its own Verify step for [A] facts;
T1 ─► T9  Codex    │   integrate through T3's adapter registry)
T1 ─► T10 Gemini   │
T1 ─► T11 Markdown ┘

T1 + WP3 PLAN ─► T15 (contract reconciliation + round-trip)
```

**Critical path:** SHARED-1/T1/T2 → T3 → T5 → (T12|T13). **Schema migrations
(SHARED-1, T2) run serially** with WP2/WP3 per `../README.md`; everything else parallel.
**Suggested order:** SHARED-1 + T1 first (unblock everything), then T2 + T4 + all six
adapters (T6–T11) in parallel, then T3, then T5/T12/T13/T14, then T15/T16.

**Adapter parallelism nuance:** T6–T11 depend only on T1 for their **service-level** work
(parse → IR) and can be built + unit-tested fully in parallel against T1. Their
**wiring-level** acceptance ("via T3 end-to-end") gates on T3 merging — schedule the
wiring test after the adapter is registered in T3's registry. Total: **17 tasks**
(SHARED-1 + T1–T16), **6 of them source adapters**.

---

## 9. Risks & open questions

- **R1 — Quota abort mid-import.** `LtmMemoryQuotaExceededError` is re-thrown, not swallowed
  (`memory-ltm.service.ts:254-260`); a large first import can hit `maxMemoriesPerUser` and
  abort. **Mitigation (D10/T3):** catch it, stop gracefully, return a partial summary +
  resumable cursor; dry-run reports `quotaHeadroom`. **Open:** should import bump/bypass the
  quota for admin runs? (defer to G1/config.)
- **R2 — WP3 contract not final.** WP3 PLAN is a stub today. **Mitigation:** §3/§5 define an
  explicit assumed contract; T15 reconciles. Risk of rework if WP3 diverges on
  `MemoryLink.type` vocabulary or slug rules — keep the contract module thin and shared.
- **R3 — `[A]` format facts** (Cursor activation/`@file`, Codex+Gemini hierarchy precedence,
  `.cursorrules`, `@import`). Each adapter task carries a mandatory `Verify` step; wrong
  guesses only affect that one adapter (isolation by design).
- **R4 — Scope/dedup interaction (D4).** A single `import` scope collapses byte-identical
  facts across tools into one multi-source memory. Usually desirable, but loses per-tool
  duplicates. **Open:** expose `--scope per-tool` to opt out? (add flag if a user needs it.)
- **R5 — Wikilink ambiguity.** Two facts with the same filename stem in different dirs both
  match `slug:<stem>`. **Mitigation:** prefer a same-dir/same-source match; on ambiguity,
  link to the first + record `metadata.ambiguous=true`; report in summary.
- **R6 — Secret scanner false negatives.** Regex-based scanning misses novel secret formats;
  `flag`/`skip` policies + `embeddingExcluded` reduce blast radius, but document that it is
  best-effort (G2). **Open:** integrate a dedicated secret-scanning lib later?
- **R7 — `pnpm-lock.yaml` churn.** Adding `@engram/memory-import` (and any YAML dep) must
  **not** regenerate the lockfile — hand-add the importer entry per
  `project-engram-tooling-gotchas`. Prefer a YAML parser already in the lockfile.
- **R8 — Link cleanup on delete.** `MemoryLink` has no DB FK to `Memory` (D-note in §6);
  app-level cleanup (SHARED-1 step 3) must cover every delete path (`delete()`, `clear()`,
  decay prune) or orphan links accumulate. Covered by SHARED-1 tests.
- **R9 — Large monolithic files.** A 200KB `AGENTS.md` H2-splits into many memories +
  amplifies embedding cost; the `INGEST_MAX_CHUNKS`-style cap (500) and dry-run cost
  estimate bound this — surface a warning above a threshold.
- **Open — Provenance on multi-source merge:** confirm the `metadata.provenance.sources[]`
  shape with WP3 so export can round-trip a multi-source memory back to N files (or one).
