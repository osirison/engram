# WP3 — Rich Markdown Export (implementation plan)

> Part of the **Memory Platform Work-Package Suite (2026-07-05)**.
> Read repo-root `CLAUDE.md` + `AGENTS.md` and the suite index
> [`../README.md`](../README.md) before executing any task here. Conventions
> (worktree-per-WP, conventional commits, dual-level tests, Zod `.strict()`,
> Postgres-as-source-of-truth, `userId: "qp"` in examples) come from that README
> and are not repeated in each task.

**This is a planning document. No code is written by WP3-planning; each task
below is executed independently later.** Audience for each task: one Opus 4.8 /
Sonnet 5 executor with no other context.

---

## 1. Context

qp wants to export ENGRAM memories as rich markdown documents where the
**relationships between memories are preserved**, in an Obsidian-compatible form
(YAML frontmatter + `[[wikilinks]]`). The export must round-trip with the WP4
import work: both sides speak one canonical frontmatter/edge contract, defined
here as a shared module so the two cannot drift (closes cross-cutting gap **G6**;
see [`../GAPS.md`](../GAPS.md)).

The central design problem is that **ENGRAM has no first-class relationship model
today** — inter-memory relationships exist only as ad-hoc JSON annotations inside
`Memory.metadata`. This plan states precisely what exists, renders it faithfully,
and defines the durable substrate (`SHARED-1: MemoryLink`) needed to make
relationships explicit, queryable, and losslessly round-trippable.

---

## 2. Current state (verified, with file:line refs)

Every claim below was read directly from the worktree.

### 2.1 The `Memory` model has NO relationship/link/graph structure

`prisma/schema.prisma` lines **84–117**. The `Memory` model fields are:
`id` (cuid2), `userId`, `organizationId?`, `scope?` (string namespace, e.g.
`agent:<id>`), `content` (`@db.Text`, ≤10KB enforced in Zod), `metadata` (`Json?`),
`tags` (`String[]`), `type` (`'short-term' | 'long-term'`), `createdAt`,
`updatedAt`, `expiresAt?` (STM only), `embedding` (`Float[]`), and
`embeddingVec` (`Unsupported("vector(1536)")?`). The only Prisma relations are to
`User` (line 106) and `Organization` (line 107). **There is no memory→memory
relation, no link/edge table, no `[[wikilink]]` parsing, and no graph structure.**
`tags` and `scope` are the only grouping primitives.

### 2.2 Relationships today live entirely in `metadata` JSON

Four kinds of inter-memory edge are written into `Memory.metadata` by LTM
services. Their exact on-disk shapes (executors must render these verbatim):

| Edge (metadata key)                                                                                                                               | Written by (file:line)                                                                                                                                               | Shape                                                      | Reproducible?                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `duplicateMatches[]`                                                                                                                              | `packages/memory-ltm/src/duplicate-detection.service.ts:41-49`                                                                                                       | `{ memoryId, score, summary, detectedAt }`                 | **Derived** — re-computed from embeddings on re-ingest (unless `skipDuplicateCheck`) |
| `contradictionMatches[]`                                                                                                                          | `packages/memory-ltm/src/contradiction-detection.service.ts:59-70`                                                                                                   | `{ memoryId, score, action, reason, summary, detectedAt }` | **Derived** — heuristic + embedding band                                             |
| `status='superseded'` + `supersededBy` + `supersededReason` + `supersededAt`                                                                      | `contradiction-detection.service.ts:79-84`                                                                                                                           | scalar fields on the _old_ memory                          | **Derived**, order-dependent state                                                   |
| insight: `isInsight`, `topic`, `sourceMemoryIds[]`, `clusterSize`, `extractedAt`; source memories back-annotated with `insightId` + `clusteredAt` | `apps/mcp-server/src/memory/insight-extraction.service.ts:174-188` (insight) and `:224-235` (`annotateSourceMemories` → `metadataMerge: { insightId, clusteredAt }`) | insight→sources fan-out + source→insight back-ref          | **NOT reproducible** — output of a scheduled LLM clustering job                      |

`metadata` also carries **runtime-derived, volatile** fields that are _not_
relationships and must be excluded from deterministic export (see §4.7):
`importance`, `status` (when not superseded), `accessCount`, `lastAccessedAt`,
`pinned` — written by `annotateImportance` / `recordAccess`
(`memory-ltm.service.ts:1383-1426`, `:1598-1621`).

**Classification that drives this plan:** duplicate/contradiction/superseded
edges are _derived_ (an importer can regenerate them, and doing so on re-ingest
would _double_ them); insight edges — and any future human-authored
`relates-to` — are _durable_ and have **no reproducible source**, so they are
lost on round-trip unless persisted as data. This is the concrete reason
`SHARED-1` is _required_, not merely nicer (§5).

### 2.3 Read/list surfaces the exporter will reuse

- **LTM** — `MemoryLtmService.list(userId, opts)`
  (`packages/memory-ltm/src/memory-ltm.service.ts:465-560`): cursor-paginated
  (`cursor`, `limit≤100`, `+1` look-ahead), filters by `organizationId`, `scope`,
  `tags` (`hasSome`), `dateFrom`/`dateTo` (on `createdAt`), `search`, `sortBy`
  (`createdAt|updatedAt`), `sortOrder`. Query schema:
  `packages/memory-ltm/src/types.ts:234-245` (`ltmQueryOptionsSchema`).
- **STM** — `MemoryStmService.list(...)`
  (`packages/memory-stm/src/memory-stm.service.ts:239-313`): Redis `SCAN`-based,
  cursor-paginated. **SCAN order is not stable and may return duplicate keys** —
  the exporter must collect-then-sort-by-id and dedup.
- Reindex precedent for cursor/batch streaming over all LTM:
  `MemoryLtmService.reindex()` (`memory-ltm.service.ts:1184-1287`) — stable
  `orderBy: { id: 'asc' }`, `skip:1 + cursor`, per-item failures counted/skipped.

### 2.4 Delivery-surface precedents

- **MCP tools** are assembled in
  `apps/mcp-server/src/memory/memory.controller.ts:getMcpTools()` (line **1075**)
  as `{ name, description, inputSchema (Zod), handler, auth?, delegable?,
requiredScope? }`. Scope map at `:1273-1288` (`memories:read|write|delete`);
  profile filter at `:1310-1331`. Registered via
  `McpHandler.registerAdditionalTools` → `registerTools`
  (`packages/core/src/mcp/tools/index.ts:209`). Identity-mode tools get the
  verified `userId` injected; `delegable:true` lets an admin-scoped key target
  another tenant (e.g. `recall`, `:1136-1139`). Tool `Tool` interface + auth
  semantics: `packages/core/src/mcp/tools/index.ts:33-61`.
- **CLI** precedent: `apps/mcp-server/src/reindex.cli.ts` — boots
  `NestFactory.createApplicationContext(AppModule.forRoot())`, `app.get(Service)`,
  runs, sets `process.exitCode`, `app.close()`. Wired as
  `"reindex": "nest build && node dist/reindex.cli.js"` in
  `apps/mcp-server/package.json` scripts.
- **Web UI**: `apps/web` (Next.js + tRPC). Memory router
  `apps/web/server/trpc/routers/memory.ts` (list/get/search/update/delete,
  `protectedProcedure`). It calls the MCP server over HTTP through
  `apps/web/server/backend/prisma-backend.ts` (`PrismaEngramBackend`,
  `fetchMcp`) + `mcp-client.ts` (`McpToolClient`). Memory UI components in
  `apps/web/components/memories/`.

### 2.5 Libraries already available

`yaml@^2.8.1` is already a dependency of `apps/mcp-server`
(`apps/mcp-server/package.json:88`). **No** zip/`archiver`/`gray-matter`/`jszip`
dependency exists yet — the streaming-zip surface (T8) must add one.

### 2.6 Embeddings

`embedding Float[]` + `embeddingVec vector(1536)` are a **derived index**
(Postgres is source of truth per CLAUDE.md). They are large, regenerable via
`reindex()`, and are **excluded** from export (§4.8).

---

## 3. Goals / Non-goals

### Goals

1. Export a user's memories as one markdown file per memory: YAML frontmatter
   (id, type, timestamps, tags, scope, provenance) + Obsidian `[[wikilinks]]`
   for inter-memory relationships, with **typed** edge semantics preserved in
   _both_ frontmatter and inline links.
2. Emit an **index / Map-of-Content (MOC)** file plus a machine-readable
   `manifest.json`.
3. Offer an optional **single-document** mode (all memories in one file with
   anchors + intra-doc links).
4. Define the **canonical frontmatter + edge contract once**, in a shared module
   (`packages/memory-interchange`), consumed by both WP3 (export) and WP4
   (import) → guaranteed round-trip (G6).
5. Deterministic, diffable output (stable ordering, stable key order, volatile
   fields quarantined to the manifest).
6. Filtering by user, tag, date range, scope, type; explicit STM-vs-LTM policy.
7. Three delivery surfaces with a stated build order: **shared lib → CLI → MCP
   tool → web zip**.
8. Streaming/batched for large exports (reuse cursor pagination).

### Non-goals

- Writing the WP4 _importer_ (only the shared contract + a parse-side round-trip
  assertion live here).
- Full authored-relationship _editing UX_ (that is WP2). WP3 only reads whatever
  edges exist (metadata-derived today, `MemoryLink` once `SHARED-1` lands).
- Exporting embeddings, or any per-agent auth model (gap G1, out of scope).
- Preserving STM TTL through a round-trip (documented as a non-goal in §4.6).

---

## 4. Design decisions

### 4.1 The canonical contract lives in `packages/memory-interchange`

A new dependency-light workspace package that both `apps/mcp-server` (export,
WP3) and the WP4 importers depend on. It exports:

- `MEMORY_INTERCHANGE_VERSION` (string const, e.g. `"1.0"`) — stamped into every
  document's frontmatter `schemaVersion`.
- `frontmatterSchema` — a Zod `.strict()` schema (the contract, §4.2).
- `EDGE_TYPES` — the closed typed-edge vocabulary (§4.3).
- `serializeMemory(input): string` — Memory + collected edges → document string.
- `parseDocument(md): { frontmatter, body }` — inverse, for WP4 + round-trip test.
- `slugify(content): string`, `buildFilename(id, content): string` — deterministic.
- `emitWikilink(edge)` / `parseWikilinks(body)` — inline `[[…]]` helpers.

Rationale: one module = one source of truth for the byte-level format; a Zod
schema shared by both directions makes drift a **compile/test failure**, not a
silent data-loss bug (G6).

### 4.2 Canonical frontmatter schema

Keys are emitted in this fixed order (determinism). All timestamps are ISO-8601
UTC (`…Z`). `links` is the **machine-readable** typed edge list; the inline
`## Related` section (§4.4) is its human/graph-visible mirror.

```yaml
schemaVersion: '1.0' # MEMORY_INTERCHANGE_VERSION
id: 'cly3k9m0a0000abcd1234' # cuid2, globally unique — the join key
type: 'long-term' # 'long-term' | 'short-term'
userId: 'qp' # owner / tenant (provenance)
scope: 'project:engram' # optional namespace; omitted when null
organizationId: 'org_...' # optional; omitted when null
tags: ['decision', 'architecture'] # sorted, deduped
createdAt: '2026-06-01T10:00:00.000Z'
updatedAt: '2026-06-02T12:30:00.000Z'
expiresAt: null # STM only; null/omitted for LTM
aliases: ['cly3k9m0a0000abcd1234'] # lets [[<id>]] resolve regardless of slug
links: # typed edges — sorted by (rel, target)
  - rel: 'derived-from'
    target: 'clx0000insightsrc01'
    origin: 'durable' # 'durable' | 'derived'  (see §4.3)
    note: 'insight cluster: architecture'
  - rel: 'duplicate-of'
    target: 'clw0000dupmemory02'
    origin: 'derived'
    score: 0.981
metadata: {} # sanitized passthrough (see §4.7); omitted when empty
provenance: # import lineage, if any (WP4 fills this in)
  source: 'engram' # or 'claude-code' | 'cursor' | ... on import
  importedFrom: null
```

Notes:

- `id` is the **join key**. Filenames/slugs are cosmetic; links never depend on
  them (they use `aliases:[id]` + `[[id|display]]`, §4.4), which removes the need
  for a global pre-pass and makes streaming safe.
- Per-file **volatile** provenance (`exportedAt`, `exporterVersion`) is
  deliberately **absent** — it lives only in `manifest.json` so per-file output
  is byte-stable across runs (diffable exports).

### 4.3 Typed edges — vocabulary + `origin`, and how the four current sources map

`EDGE_TYPES` (closed set): `relates-to`, `duplicate-of`, `contradicts`,
`superseded-by`, `supersedes`, `derived-from`, `source-of`.

Every edge carries `origin`:

- `origin: "derived"` — reproducible by re-running detection on re-ingest
  (duplicate/contradiction/superseded). WP4 restores these **verbatim with
  detection disabled** (`skipDuplicateCheck: true`, no contradiction pass) so
  round-trip does not _double_ them.
- `origin: "durable"` — has no reproducible source; must survive round-trip as
  data (insight edges; future authored `relates-to`). These are the reason
  `SHARED-1` exists.

Mapping from current `metadata` (§2.2) to canonical edges (the T4 collector):

| metadata source                   | canonical edge (on subject)                | inverse (on target)        | origin         |
| --------------------------------- | ------------------------------------------ | -------------------------- | -------------- |
| `duplicateMatches[].memoryId`     | `duplicate-of` → target (with `score`)     | `duplicate-of`             | derived        |
| `contradictionMatches[].memoryId` | `contradicts` → target (`score`, `reason`) | `contradicts`              | derived        |
| `supersededBy` (on old memory)    | `superseded-by` → new                      | `supersedes` (on new)      | derived        |
| insight `sourceMemoryIds[]`       | `derived-from` → each source               | `source-of` (on source)    | durable        |
| source memory `insightId`         | `derived-from` → insight                   | `source-of`                | durable        |
| `MemoryLink` row (SHARED-1)       | its `relType` verbatim                     | stored inverse or computed | row's `origin` |

Inverses are emitted **only if the target is in the export set** (avoid dangling —
§4.9). Edge list is sorted by `(rel, target)` and deduped on `(rel, target)`.

### 4.4 Inline wikilinks (Obsidian-compatible) — the human/graph mirror

Below the memory body, a fixed section renders the same edges as native
wikilinks so Obsidian's graph view and backlinks work, with the type visible:

```markdown
## Related

- **derived-from** [[clx0000insightsrc01|Architecture insight: prefer pgvector]]
- **duplicate-of** [[clw0000dupmemory02|We chose pgvector over Qdrant]] (0.98)
```

- Link target is the memory `id` (resolves via the target file's `aliases:[id]`),
  with a human display after `|`. This is robust to slug collisions/renames and
  needs no pre-pass.
- The bold `**rel**` label + the frontmatter `links` entry together carry the
  typed semantics (Obsidian doesn't type links natively). Optional Dataview
  inline field (`rel:: [[id]]`) is **out of scope** — keep one canonical inline
  form.

### 4.5 Filename / slug strategy + collision handling

`buildFilename(id, content)` = `<slug>--<id>.md` where
`slug = slugify(firstNonEmptyLine(content))`: lowercase, transliterate to ASCII,
non-alphanumerics → `-`, collapse repeats, trim, truncate to ≤60 chars; empty →
`"memory"`. Because the full cuid2 `id` is appended, **filenames are globally
unique** (cuid2 is collision-free) — the slug is purely cosmetic. Determinism:
`slugify` is a pure function of content. Files are written under
`memories/` (flat) or `memories/<type>/` (see manifest option); the MOC and
manifest sit at the export root.

### 4.6 STM vs LTM inclusion — explicit default + TTL behavior

- **Default: LTM only.** STM is transient Redis-backed working memory that
  expires; exporting it by default would capture ephemeral state and produce
  non-reproducible snapshots. Include STM only when the caller passes
  `includeStm: true`.
- When included: STM docs carry `type: short-term`, real `expiresAt`, and a
  manifest note `ttlSecondsRemaining` (point-in-time). Already-expired entries
  are simply absent from Redis `SCAN`, so they never appear.
- **TTL is not preserved on round-trip** (documented non-goal): WP4 import of an
  STM doc recreates it as a fresh STM entry with a default/derived TTL (or as LTM
  if the importer is told to), because the original countdown is meaningless at a
  later import time. State this in the doc + manifest.
- STM SCAN ordering is unstable/duplicative → collect all, dedup by id, sort by
  id before serialization.

### 4.7 `metadata` passthrough — sanitized

The frontmatter `metadata` object carries **only** non-relationship, non-volatile
custom keys. The serializer strips: (a) every relationship key consumed into
`links` (`duplicateMatches`, `contradictionMatches`, `supersededBy`,
`supersededReason`, `supersededAt`, `sourceMemoryIds`, `insightId`,
`clusteredAt`, `isInsight`, `topic`, `clusterSize`, `extractedAt`); (b) volatile
runtime keys (`importance`, `status`, `accessCount`, `lastAccessedAt`, `pinned`,
`detectedAt`). Remaining keys pass through verbatim (sorted). Empty → omit key.

### 4.8 Embeddings + non-markdown content

- **Embeddings excluded** entirely (derived index; regenerate post-import via
  `reindex` — the documented "import with `EMBEDDING_PROVIDER=local`, then
  reindex" path, gap G7). Manifest notes this so operators know to reindex.
- **Content is plain text ≤10KB** (no binary). But content may contain YAML/MD
  breakers: a leading `---`, code fences, or `[[`. The serializer (a) never puts
  content in YAML — it goes in the markdown body; (b) fences/escapes as needed;
  (c) escapes literal `[[`/`]]` in body so they are not mistaken for wikilinks.
  Round-trip test must cover a memory whose content contains `---` and `[[x]]`.

### 4.9 Dangling cross-references (filtered exports)

A filtered export (by tag/date/scope) will have edges whose target is outside the
export set. Policy: keep the `links` frontmatter entry (it records the true edge)
but mark it `dangling: true`; render the inline wikilink as **plain text**
(`duplicate-of clw0000… (not in export)`) rather than a live `[[…]]`, so Obsidian
does not create a phantom note. The manifest lists dangling target ids. WP4 import
tolerates dangling edges (skips the FK/insert for absent targets).

### 4.10 Round-trip contract (defines what T9 + WP4 must satisfy — G6)

Export → parse → re-import into a clean DB must reproduce, for each memory:
`id`, `content`, `tags`, `type`, `scope`, and **durable** edges. It must **NOT**
require reproducing volatile fields (`updatedAt`, `importance`, `accessCount`,
`lastAccessedAt`, `detectedAt`) or _derived_ edges regenerated by detection.
Import restores edges with detection disabled (`skipDuplicateCheck: true`) to
avoid doubling. The diff in the round-trip test compares the **durable projection**
only. This makes the test pass _by construction_ instead of fighting volatility.

### 4.11 Delivery surfaces + build order

1. **`packages/memory-interchange` (shared lib)** — first; everything depends on it.
2. **CLI `export`** (T6) — **build first among surfaces.** Mirrors the reindex
   CLI, writes to a directory, no transport size limit, easiest to test on large
   data, and is what qp will actually use for a full Obsidian vault dump.
3. **MCP tool `export_memories`** (T7) — second. Bounded inline result; large
   exports return a **server-path reference**, not a base64 zip (a base64 zip in
   an MCP text response blows the token budget). `auth`: identity-mode,
   `requiredScope: memories:read`, `delegable: true` (mirror `recall`).
4. **Web UI download-as-zip** (T8) — last. tRPC `memory.export` →
   mcp-server streaming-zip HTTP endpoint → browser download.

### 4.12 Streaming / batching / determinism summary

- Page LTM via `list` cursor (`orderBy` forced to `id asc` for a stable global
  order); STM via SCAN then global id sort. Serialize one memory at a time to
  disk / zip stream → bounded memory for large exports.
- No global pre-pass needed: links target `id` (resolved by `aliases`), so
  forward references just work.
- Determinism levers: global sort by `id`; fixed frontmatter key order; sorted
  tags/edges/metadata keys; LF newlines; trailing-newline normalization;
  volatile fields only in `manifest.json`; a `--deterministic` flag may also omit
  the manifest's `exportedAt` for byte-identical CI diffs.

---

## 5. Schema changes

### SHARED-1: `MemoryLink` schema + migration _(shared prerequisite)_

> **Superseded:** WP3 and WP4 drafted divergent `MemoryLink` models. Implement the
> reconciled canonical model in [`../SHARED-1-memory-link.md`](../SHARED-1-memory-link.md)
> instead of the draft below (kept for rationale).

> **Same task name every WP uses.** WP2 (authored links UI), WP3 (export, reads),
> WP4 (import, writes) all consume `MemoryLink`. Per `../README.md`, apply schema
> migrations **serially** across WPs; everything else runs in parallel. **WP3's
> export does NOT hard-block on this** — see the dependency note below.

**Why required (not just nicer):** _durable_ edges — insight `derived-from`/
`source-of` and any future human-authored `relates-to` — have **no reproducible
source**. Left in `metadata` they are lost or non-deterministically regenerated
on round-trip. `MemoryLink` gives them a first-class, queryable, idempotently
importable home.

**Model** (`prisma/schema.prisma`):

```prisma
model MemoryLink {
  id             String   @id @default(cuid(2))
  sourceMemoryId String
  targetMemoryId String
  relType        String   // closed set enforced in Zod: EDGE_TYPES (§4.3)
  origin         String   @default("authored") // 'authored' | 'derived'
  score          Float?
  note           String?
  metadata       Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  source Memory @relation("MemoryLinkSource", fields: [sourceMemoryId], references: [id], onDelete: Cascade)
  target Memory @relation("MemoryLinkTarget", fields: [targetMemoryId], references: [id], onDelete: Cascade)

  @@unique([sourceMemoryId, targetMemoryId, relType]) // idempotent import; prevents round-trip doubling
  @@index([sourceMemoryId])
  @@index([targetMemoryId])
  @@map("memory_links")
}
```

Also add back-relations on `Memory`:
`outgoingLinks MemoryLink[] @relation("MemoryLinkSource")` and
`incomingLinks MemoryLink[] @relation("MemoryLinkTarget")`.

**Files:** `prisma/schema.prisma` (model + `Memory` back-relations); migration
via `pnpm db:migrate` (name `add_memory_links`); regenerate client `pnpm db:generate`.

**Acceptance:** migration applies on a clean DB; unique constraint rejects a
second identical `(source,target,relType)`; `onDelete: Cascade` removes links when
either memory is deleted; `pnpm db:generate` + `pnpm typecheck` pass.

**Dependency note for WP3:** the export **edge collector (T4)** reads
metadata-derived edges **and** `MemoryLink` rows as a _pluggable additive source_.
If `SHARED-1` has not landed, T4/T5/T6 ship reading metadata edges only (fully
functional for everything that exists today); `MemoryLink` reading is an additive
branch guarded by a capability check. **Direction: WP3 reads, WP4 writes.**

---

## 6. Work breakdown

> Sizes: **S** ≤ ½ day, **M** ~1 day, **L** ~2 days. Each task is self-contained;
> read the file:line refs in §2 before starting. All new object schemas use Zod
> `.strict()`. Tests required at **both** service level and wiring level.

### T1 — Scaffold `packages/memory-interchange` + frontmatter schema _(S/M)_

- **Create:** `packages/memory-interchange/package.json` (workspace pkg, deps:
  `zod`, `yaml`; follow an existing leaf package e.g. `packages/eval` for
  `tsconfig`/`tsup`/eslint wiring), `.../src/index.ts`, `.../src/version.ts`
  (`export const MEMORY_INTERCHANGE_VERSION = "1.0"`),
  `.../src/frontmatter.schema.ts` (`frontmatterSchema` per §4.2, `.strict()`),
  `.../src/edge-types.ts` (`EDGE_TYPES` const + `EdgeType` type + `edgeSchema`),
  `.../tsconfig.json`, `.../tsup.config.ts`.
- **Steps:** define the Zod schema exactly as §4.2/§4.3; export inferred types
  (`Frontmatter`, `MemoryEdge`); add package to root `pnpm-workspace` glob (it is
  already `packages/*`, so no lockfile edit — **do not regenerate the lockfile**).
- **Acceptance:** `pnpm --filter @engram/memory-interchange build` + `typecheck`
  pass; schema round-trips a canonical example object.
- **Tests (service):** `frontmatter.schema.spec.ts` — valid object parses;
  unknown key rejected (`.strict()`); bad `rel`/`origin`/`type` rejected;
  timestamp format enforced.
- **Tests (wiring):** none yet (leaf lib). Consumed by T3+.
- **Depends-on:** none.

### T2 — Slug + wikilink utilities _(S)_

- **Create:** `packages/memory-interchange/src/slug.ts` (`slugify`,
  `buildFilename` per §4.5), `.../src/wikilink.ts` (`emitWikilink(edge)`,
  `parseWikilinks(body)` per §4.4), export from `index.ts`.
- **Steps:** pure functions; ASCII transliteration; 60-char cap; `[[id|display]]`
  emit; regex parse tolerant of `|display` and trailing `(score)`.
- **Acceptance:** deterministic — same input → identical output across runs.
- **Tests (service):** `slug.spec.ts` (unicode, empty, >60 chars, collision safety
  via appended id), `wikilink.spec.ts` (emit↔parse inverse; escaping of literal
  `[[` in body content).
- **Depends-on:** T1.

### T3 — `serializeMemory()` + `parseDocument()` _(M)_

- **Create:** `packages/memory-interchange/src/serialize.ts`
  (`serializeMemory(input): string`), `.../src/parse.ts`
  (`parseDocument(md): { frontmatter, body }`), export both.
- **Input shape:** `{ memory: CanonicalMemory, edges: MemoryEdge[], mode:
'multi'|'single' }` where `CanonicalMemory` is the sanitized projection (id,
  type, userId, scope, org, tags, timestamps, expiresAt, sanitized metadata,
  provenance). Edge collection is T4's job; T3 only renders a given edge list.
- **Steps:** emit YAML frontmatter in fixed key order via `yaml`; body = escaped
  content + `## Related` section (§4.4); mark dangling edges plain-text (§4.9);
  fixed sorts (§4.12). `parseDocument` is the exact inverse (for WP4 + T9).
- **Acceptance:** `parseDocument(serializeMemory(x)).frontmatter` deep-equals the
  input frontmatter projection; output is byte-identical across repeated calls.
- **Tests (service):** golden-file test of a full example doc (matches §4.2/§4.4);
  content containing `---` and `[[x]]` survives round-trip; empty metadata omits
  the key; single-doc mode emits anchors + `[[#mem-<id>]]` intra-links.
- **Depends-on:** T1, T2.

### T4 — Edge collector (metadata + MemoryLink → canonical edges) _(M)_

- **Create:** `apps/mcp-server/src/memory/export/edge-collector.ts`
  (`EdgeCollectorService` or a pure function `collectEdges(memories,
memoryLinks?)`). Rationale for app-level (not in the leaf lib): it depends on
  ENGRAM's `metadata` shapes + Prisma, which the shared lib must stay free of.
- **Steps:** implement the §4.3 mapping table for all four metadata sources +
  optional `MemoryLink` rows; compute inverses only when target ∈ export set;
  set `origin` per source; sort + dedup on `(rel, target)`; mark `dangling` when
  target ∉ export set (§4.9). Guard the `MemoryLink` branch behind a capability
  check so it is a no-op until SHARED-1 lands.
- **Acceptance:** given fixtures covering all four metadata edge kinds, produces
  the exact canonical edge list; no doubling; inverses correct; dangling flagged.
- **Tests (service):** `edge-collector.spec.ts` — one fixture per edge kind +
  a mixed fixture + a filtered (dangling) fixture + (when present) a MemoryLink
  fixture.
- **Depends-on:** T3 (edge type); **SHARED-1 optional/additive** (see §5 note).

### T5 — `MemoryExportService` (orchestrator) _(L)_

- **Create:** `apps/mcp-server/src/memory/export/memory-export.service.ts` +
  `.../export/export.types.ts` (options + result). Register in
  `apps/mcp-server/src/memory/memory.module.ts`.
- **Options:** `{ userId, includeStm?=false, tags?, dateFrom?, dateTo?, scope?,
type?, mode?='multi', deterministic?=false, sink }` where `sink` is a writer
  abstraction (dir writer for CLI, zip stream for UI) so the same core drives all
  surfaces.
- **Steps:** page LTM via `MemoryLtmService.list` forcing `id asc`; if
  `includeStm`, SCAN STM (`MemoryStmService.list`), dedup by id, merge, global
  sort by id; sanitize each memory (§4.7); run T4 collector over the whole set;
  `serializeMemory` each → `sink.writeFile(filename, content)`; build the MOC
  `index.md` (grouped by type→tag with `[[id|display]]` links) and
  `manifest.json` (filters, counts, `MEMORY_INTERCHANGE_VERSION`, exportedAt
  unless `deterministic`, dangling ids, "run reindex after import" note); support
  `mode: 'single'` (one file, anchors). Per-item failures counted + skipped
  (mirror `reindex`), never abort.
- **Acceptance:** exporting a seeded user yields N per-memory files + index +
  manifest; re-running with `deterministic:true` is byte-identical; filtered
  export flags dangling edges; STM excluded unless `includeStm`.
- **Tests (service):** `memory-export.service.spec.ts` — in-memory sink; asserts
  file set, MOC contents, manifest, determinism, STM default-off, dangling.
- **Tests (wiring):** exercised via T6/T7 wiring tests below.
- **Depends-on:** T3, T4.

### T6 — CLI `export` command _(M)_ — **first delivery surface**

- **Create:** `apps/mcp-server/src/export.cli.ts` (clone `reindex.cli.ts`
  structure); add script `"export": "nest build && node dist/export.cli.js"` to
  `apps/mcp-server/package.json`.
- **Flags:** `--user <id>` (required), `--out <dir>`, `--include-stm`,
  `--tag <t>` (repeatable), `--from <iso>`, `--to <iso>`, `--scope <s>`,
  `--single`, `--deterministic`. Directory `sink` writes files under `--out`.
- **Acceptance:** `pnpm --filter mcp-server export -- --user qp --out ./vault`
  writes a browsable Obsidian vault; exit code non-zero if any item failed.
- **Tests (service):** `export.cli.spec.ts` — `parseArgs` unit tests (mirror
  reindex CLI test style).
- **Tests (wiring):** a spec booting an app context against seeded LTM (or a
  mocked `MemoryExportService`) that runs the CLI `main()` and asserts files land
  in a temp dir + manifest is valid.
- **Depends-on:** T5.

### T7 — MCP tool `export_memories` _(M)_

- **Create:** `apps/mcp-server/src/memory/dto/export.dto.ts`
  (`exportToolSchema`, Zod `.strict()`: `userId`, `includeStm?`, `tags?`,
  `dateFrom?`, `dateTo?`, `scope?`, `type?`, `mode?`, `maxInline?`). Add handler
  `exportMemories()` to `memory.controller.ts` and a tool entry in
  `getMcpTools()` (§2.4 pattern) with `requiredScope: memories:read`,
  `delegable: true`, identity mode; add `export_memories: 'memories:read'` to the
  scope map (`:1273`).
- **Result contract:** bounded exports (≤ `maxInline`, default e.g. 25 files)
  return the documents + manifest **inline** as JSON; larger exports write to a
  server-side dir via the same `sink` and return a **path reference + manifest
  summary** (never a base64 zip — §4.11). Respect the profile filter
  (`filterToolsByProfile`) if the surface should be gated.
- **Acceptance:** `tools/list` advertises `export_memories`; a `memories:read`
  key can call it; an admin key can delegate via explicit `userId`; bounded call
  returns inline docs, oversize call returns a path ref.
- **Tests (service):** handler unit test (mocked `MemoryExportService`): inline vs
  path branch; filter pass-through.
- **Tests (wiring):** extend the MCP dispatch/registration spec
  (`memory.controller.spec.ts` / `mcp-delegation-wiring.spec.ts` style) to assert
  the tool is registered, scope-gated (`memories:read` required, `memories:write`
  key rejected), and delegation-honored.
- **Depends-on:** T5.

### T8 — Web UI download-as-zip _(L)_ — **last delivery surface**

- **Create:** streaming-zip HTTP endpoint on mcp-server
  (`apps/mcp-server/src/memory/export/export.controller.ts`, a NestJS controller
  streaming `archiver`/zip using the zip `sink`; add the zip dep to
  `apps/mcp-server/package.json` — **do not regenerate the lockfile**, use the
  installed pnpm version per README); tRPC `export` procedure in
  `apps/web/server/trpc/routers/memory.ts` calling it through `prisma-backend.ts`
  (`fetchMcp`) / `mcp-client.ts`; an "Export" button + options dialog in
  `apps/web/components/memories/` triggering a browser download.
- **Steps:** stream memory-by-memory into the zip (bounded memory); pass filters
  from the UI; auth via the existing web→mcp path (`memories:read`).
- **Acceptance:** clicking Export downloads a `.zip` that unzips to a valid vault
  (files + index + manifest); large exports stream without OOM.
- **Tests (service):** endpoint spec — streams a valid zip; filter propagation.
- **Tests (wiring):** tRPC router test (mirror `routers.test.ts`) that the
  `export` procedure calls the backend with mapped inputs; a component test for
  the Export button (mirror `memory-list.test.tsx`).
- **Depends-on:** T7.

### T9 — Round-trip contract test harness _(M)_ — closes G6 (WP3 half)

- **Create:** `packages/memory-interchange/src/roundtrip.spec.ts` (parse-side) and
  an e2e stub `apps/mcp-server/test/export-roundtrip.e2e-spec.ts` that WP4
  completes with the DB-import half.
- **Steps:** serialize a fixture set (incl. all edge kinds, dangling, `---`/`[[`
  content, STM + LTM) → `parseDocument` → assert the **durable projection**
  (§4.10: id, content, tags, type, scope, durable edges) is reproduced; assert
  volatile fields and derived-edge doubling are explicitly _not_ required.
- **Acceptance:** round-trip passes on the durable projection; a deliberately
  volatile field mismatch does **not** fail the test (proving the projection is
  correct); documents the exact assertion WP4's import side must satisfy.
- **Tests (service):** the spec itself.
- **Tests (wiring):** the e2e stub registers in the mcp-server e2e config
  (skipped/`todo` until WP4) so the contract is visible to WP4 executors.
- **Depends-on:** T3, T5.

---

## 7. Dependency graph

```
SHARED-1 (MemoryLink)  ─ (additive, optional for WP3) ─┐
                                                        ▼
T1 (pkg + schema) ─► T2 (slug/wikilink) ─► T3 (serialize/parse)
                                              │
                                              ├─► T4 (edge collector) ──┐
                                              │                         ▼
                                              └────────────────────►  T5 (export service)
                                                                        │
                                            ┌───────────────┬───────────┤
                                            ▼               ▼           ▼
                                        T6 (CLI, 1st)   T7 (MCP tool)  T9 (round-trip)
                                                            │
                                                            ▼
                                                        T8 (web zip, last)
```

- Critical path to a usable export: **T1 → T2 → T3 → T4 → T5 → T6** (CLI).
- T7 and T9 parallel after T5; T8 after T7.
- SHARED-1 can land any time (serially vs other WPs' migrations); WP3 does not
  block on it — T4 reads `MemoryLink` additively when present.

---

## 8. Risks & open questions

1. **Round-trip doubling of derived edges (highest).** If WP4 re-ingests with
   detection ON, duplicate/contradiction edges double and `detectedAt` churns.
   Mitigated by the §4.10 contract (import with detection off; diff durable
   projection only) + SHARED-1 `@@unique(source,target,relType)`. WP4 executors
   must honor this — T9 encodes it.
2. **Durable edges lost without SHARED-1.** If SHARED-1 slips, insight
   `derived-from` edges are exported (from metadata) but WP4 has nowhere durable
   to re-store them idempotently → they'd re-derive nondeterministically or drop.
   Ship SHARED-1 before WP4's importer, per suite README ordering.
3. **MCP token blow-up.** Large inline exports would flood the MCP text channel;
   §4.11 path-reference mode mitigates, but the `maxInline` default needs tuning
   against real memory sizes (≤10KB each).
4. **Filtered-export dangling edges** create phantom Obsidian notes if rendered as
   live wikilinks. §4.9 plain-text policy mitigates; confirm qp's preferred
   behavior (drop vs stub vs plain-text).
5. **STM export semantics.** Default-off is decided; open question whether qp ever
   wants STM in a vault at all, or only LTM. TTL is explicitly not round-tripped.
6. **Auth (gap G1).** `userId` is caller-trusted today; export honors identity
   injection + `delegable`, but until per-user API keys exist (G1), an
   unauthenticated MCP caller could export another `userId`'s memories. Note in
   the tool's security section; real fix is G1, out of WP3 scope.
7. **Single-doc scalability.** `mode:'single'` for a 10k-memory user yields a
   huge file; document a soft cap / warn, keep multi-file as default.
8. **`memory-interchange` boundary purity.** Keep the shared lib free of Prisma /
   NestJS / ENGRAM metadata shapes (only the canonical contract) so WP4 importers
   can depend on it without pulling the server. The metadata→edge mapping stays in
   T4 (app layer), not the lib.
