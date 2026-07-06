---
title: WP6 — Developer Documentation App (Plan)
description: Plan for a full developer documentation site covering every Engram feature and function using standard open-source docs tooling
---

# WP6 — Developer Documentation App (Implementation Plan)

> Status: DRAFT 2026-07-05. See `../README.md` for suite-wide conventions.
> This WP is **standalone**: execute it at any time; it documents whatever exists at
> execution time. No code changes; all deliverables are docs infrastructure and content.

---

## 1. Context

ENGRAM is a TypeScript monorepo (pnpm workspaces + Turborepo) for an MCP memory server.
At the time this plan was written the following documentation infrastructure exists:

| Surface               | State                                                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/docs`           | Pure Turborepo boilerplate (Next.js 16.2.6). Zero Engram content. Has `node_modules` but no MDX, no nav, no content pages.                                                                                                                                  |
| `docs/` (root)        | 10 Markdown files with YAML frontmatter. Real operational content: setup, deploy, observability, capacity, backup, security, roadmap, release gates.                                                                                                        |
| `pnpm docs:check`     | Runs `.github/check-docs.mjs`: lints `.md` files only for frontmatter (`title` + `description`), broken relative links, and duplicate headings. Does NOT touch `.mdx`.                                                                                      |
| GitHub Pages          | **Already occupied** by `apps/marketing-site` (Vite + React 18, CNAME `engram.events`). Workflow: `.github/workflows/node.js.yml`. Single `github-pages` environment; `concurrency: group: pages`. GitHub allows exactly one Pages artifact per repository. |
| `apps/marketing-site` | Intentionally excluded from pnpm workspace (has its own `package-lock.json`). Deployed to Pages independently from the main CI.                                                                                                                             |

**Key architectural constraint discovered during planning**: GitHub Pages is a
single-site resource. The marketing site already holds that slot. A docs app that
also deploys to Pages must either (a) merge its build output into the marketing-site
artifact, or (b) use a different host. This constraint is the primary driver of the
tooling recommendation in §3.

---

## 2. Current state

### 2.1 Existing documentation inventory

All files listed pass `pnpm docs:check` today (frontmatter present). Broken-link
status was verified by running `node .github/check-docs.mjs` mentally against the
paths listed; all internal links resolve.

| File                                                       | Lines | Content summary                                                                                                             | Disposition                                                                 |
| ---------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `docs/SETUP.md`                                            | 416   | Three deployment profiles (memory/lite/enterprise), MCP client setup, profile-to-profile migration runbook, troubleshooting | **Migrate** → `/getting-started/` (tutorials) + `/how-to/profile-migration` |
| `docs/deploy.md`                                           | 239   | Docker image build, single-host Docker Compose, Kubernetes stub, env vars, health check URLs                                | **Migrate** → `/how-to/deploy-production`                                   |
| `docs/observability.md`                                    | 100   | OTel tracing, Prometheus metrics endpoint, health endpoints                                                                 | **Migrate** → `/reference/observability` + `/how-to/enable-observability`   |
| `docs/CAPACITY.md`                                         | 149   | Latency budgets, memory limits, STM consolidation thresholds                                                                | **Migrate** → `/reference/capacity`                                         |
| `docs/RELEASE_GATES.md`                                    | 162   | SLO targets, gate criteria for each tier, migration hard-stop fraction                                                      | **Migrate** → `/reference/release-gates`                                    |
| `docs/roadmap.md`                                          | 88    | Feature roadmap items                                                                                                       | **Migrate** → `/contributing/roadmap`                                       |
| `docs/ops/backup-runbook.md`                               | ~90   | pg_dump, Redis BGSAVE, Qdrant snapshot procedures                                                                           | **Migrate** → `/how-to/backup-and-restore`                                  |
| `docs/security/owasp-checklist.md`                         | ~80   | OWASP Top 10 checklist                                                                                                      | **Migrate** → `/reference/security`                                         |
| `docs/reviews/2026-07-02-security-functionality-review.md` | ~long | Full security review report                                                                                                 | **Migrate** → `/reference/security-reviews/2026-07-02`                      |
| `docs/enterprise-plan.md`                                  | ~300  | Comparison vs context-mem, 10-stream roadmap                                                                                | **Retire** (internal planning artifact; superseded by WP suite)             |

**Files that link into `docs/` from their current location** (these will break if
`docs/*.md` move without updating referrers):

| Referring file       | Link target                   | Action                                                                                |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `AGENTS.md:116`      | `docs/SETUP.md`               | Update to new URL when docs site ships; keep `docs/SETUP.md` stub with redirect prose |
| `CLAUDE.md` (bottom) | `docs/SETUP.md`               | Same                                                                                  |
| `docs/SETUP.md:244`  | `RELEASE_GATES.md` (relative) | Rewrite as cross-reference in new site nav                                            |

**Decision**: Existing `docs/*.md` files will be **kept in place as stubs** after
migration (one-line note pointing to the new docs URL), preserving relative links
from `AGENTS.md` / `CLAUDE.md` so `pnpm docs:check` never goes red during the
transition. The canonical content moves into the docs app. Stubs must carry
frontmatter to satisfy check-docs.

### 2.2 `apps/docs` — boilerplate assessment

`apps/docs/app/page.tsx` renders the Turborepo "get started" splash page with
Vercel/Turborepo logos and links to turborepo.com. It carries `@repo/ui` and
`next@^16.2.6`. There is no content, no nav, no MDX configuration, and no routing
beyond the single root route. It is **100% boilerplate** with zero sunk-cost content.

Implication: the executor may replace `apps/docs` entirely (swap frameworks) at zero
content-migration cost.

### 2.3 MCP tools to document

21 tools across two definition sites:

| Tool                     | Source                                                 | Schema location                                       |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| `ping`                   | `packages/core/src/mcp/tools/ping.tool.ts`             | `pingInputSchema` (z.object({}).strict())             |
| `create_memory`          | `apps/mcp-server/src/memory/memory.controller.ts:1078` | `apps/mcp-server/src/memory/dto/create-memory.dto.ts` |
| `get_memory`             | same, L1086                                            | `get-memory.dto.ts`                                   |
| `list_memories`          | same, L1094                                            | `list-memories.dto.ts`                                |
| `update_memory`          | same, L1102                                            | `update-memory.dto.ts`                                |
| `delete_memory`          | same, L1113                                            | `get-memory.dto.ts` (reuses GetMemoryToolInput)       |
| `promote_memory`         | same, L1124                                            | `get-memory.dto.ts`                                   |
| `recall`                 | same, L1132                                            | `recall.dto.ts`                                       |
| `reindex_memories`       | same, L1142                                            | `reindex.dto.ts`                                      |
| `queue_reindex_memories` | same, L1152                                            | `reindex-job.dto.ts` (reindexQueueToolSchema)         |
| `get_reindex_status`     | same, L1162                                            | `reindex-job.dto.ts` (reindexStatusToolSchema)        |
| `cancel_reindex_job`     | same, L1172                                            | `reindex-job.dto.ts` (reindexCancelToolSchema)        |
| `retry_reindex_job`      | same, L1182                                            | `reindex-job.dto.ts` (reindexRetryToolSchema)         |
| `consolidate_memories`   | same, L1192                                            | `consolidate.dto.ts`                                  |
| `remember`               | same, L1203                                            | `remember.dto.ts`                                     |
| `forget`                 | same, L1212                                            | `forget.dto.ts`                                       |
| `reflect`                | same, L1219                                            | `reflect.dto.ts`                                      |
| `compress_context`       | same, L1228                                            | `context.dto.ts` (compressContextToolSchema)          |
| `load_context`           | same, L1237                                            | `context.dto.ts` (loadContextToolSchema)              |
| `ingest_conversation`    | same, L1247                                            | `ingest-conversation.dto.ts`                          |
| `prompt_context`         | same, L1257                                            | `context.dto.ts` (promptContextToolSchema)            |

**Generator source note**: `zodToJsonSchema()` already exists in
`packages/core/src/mcp/tools/index.ts` and wraps `z.toJSONSchema()` (Zod v4). The
tool-reference generator must import and call this function rather than re-deriving it.

### 2.4 Packages to document (TypeDoc scope)

| Package                | Source files (non-spec .ts) | Top-level exports         | TypeDoc priority                                          |
| ---------------------- | --------------------------- | ------------------------- | --------------------------------------------------------- |
| `@engram/config`       | 2                           | 2 (re-exports ~8 symbols) | **High** — every env var                                  |
| `@engram/core`         | 6                           | 8                         | **High** — Tool interface, registerTools, zodToJsonSchema |
| `@engram/memory-stm`   | 4                           | 5                         | **High** — MemoryStmService public API                    |
| `@engram/memory-ltm`   | 13                          | 17                        | **High** — MemoryLtmService, reindex()                    |
| `@engram/embeddings`   | 8                           | 10                        | High — EmbeddingsService                                  |
| `@engram/vector-store` | 6                           | 9                         | High — VectorStoreService, backends                       |
| `@engram/database`     | 3                           | 3                         | Medium — PrismaService re-export                          |
| `@engram/redis`        | 3                           | 3                         | Medium — RedisService                                     |
| `@engram/auth`         | 9                           | 12                        | High — auth middleware, API key service                   |
| `@engram/memory-lite`  | 4                           | 4                         | Medium — LiteJsonStore (profile-lite only)                |
| `@engram/eval`         | 8                           | 14                        | Medium — recall quality harness                           |
| `@engram/client`       | 1                           | 3                         | Low — SDK wrapper (pre-release)                           |

Total TypeDoc scope: ~67 source files, ~100 exported symbols.

### 2.5 Environment variables to document

`packages/config/src/env.schema.ts` defines `baseSchema` (a `z.object()`) then wraps
it in a profile-aware `.transform()` to produce `envSchema` (a `ZodEffects`, not a
`ZodObject`). Introspection for the generator must use `baseSchema`, which is
**not currently exported**. Task T3 includes adding `export const baseSchema` to
`packages/config/src/env.schema.ts` and `packages/config/src/index.ts`.

Counted from `baseSchema`: **32 env var fields** including NODE*ENV, PORT,
DATABASE_URL, REDIS_URL, QDRANT_URL, OPENAI_API_KEY, EMBEDDING_PROVIDER,
VECTOR_BACKEND, VECTOR_COLLECTION, VECTOR_DIMENSIONS, MCP_TRANSPORT,
STM_CONSOLIDATION_ACCESS_THRESHOLD, STM_CONSOLIDATION_INTERVAL_MS,
PGVECTOR_HNSW*{M,EF*CONSTRUCTION,EF_SEARCH}, DEPLOYMENT_PROFILE, JWT_SECRET,
JWT_EXPIRES_IN, AUTH_REQUIRED, OAUTH_REDIRECT_BASE_URL, GITHUB*{CLIENT*ID,CLIENT_SECRET},
GOOGLE*{CLIENT*ID,CLIENT_SECRET}, RATE_LIMIT*{ENABLED,WINDOW_SEC,USER_RPM,ORG_RPM,IP_RPM,TOOL_OVERRIDES}.

**Important: env vars read outside `baseSchema`** (confirmed by `grep -rhoP "process\.env\.\K[A-Z0-9_]+"` across `apps/` and `packages/` during planning):
The following vars are consumed directly via `process.env` but NOT validated by `envSchema`.
They must appear in the configuration reference. T3 generates a supplementary
"Unvalidated variables" section (labelled "not schema-validated") for these:

| Variable                             | Where consumed          | Notes                                                |
| ------------------------------------ | ----------------------- | ---------------------------------------------------- |
| `MCP_ADMIN_TOKEN`                    | `apps/mcp-server`       | Required for all admin MCP tools — security-critical |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | observability           | Omit to disable OTel (no overhead)                   |
| `OTEL_SERVICE_NAME`                  | observability           | OTel service name                                    |
| `BACKUP_DIR`                         | backup scripts          | Default: `./backups`                                 |
| `BACKUP_RETENTION_DAYS`              | backup scripts          | Default: 30                                          |
| `LOG_LEVEL`                          | logging module          | `debug`/`info`/`warn`/`error`                        |
| `ALLOW_UNAUTHENTICATED_HTTP`         | auth                    | Dev override; never set in production                |
| `CORS_ALLOWED_ORIGINS`               | HTTP config             | Comma-separated origins                              |
| `ENGRAM_DEFAULT_USER_ID`             | multi-tenancy           | Fallback userId when AUTH_REQUIRED=false             |
| `ENGRAM_API_KEY`                     | API key auth            | Pre-shared key alternative to JWT                    |
| `ENGRAM_ADMIN_EMAILS`                | auth                    | Comma-separated admin email list                     |
| `METRICS_TOKEN`                      | Prometheus endpoint     | Bearer token for `/health/metrics`                   |
| `QDRANT_API_KEY`                     | Qdrant backend          | Optional Qdrant auth key                             |
| `MEMORY_DUPLICATE_THRESHOLD`         | dedup logic             | Cosine similarity threshold                          |
| `MEMORY_CONTRADICTION_THRESHOLD`     | contradiction detection | Lower bound                                          |
| `MEMORY_CONTRADICTION_THRESHOLD_MAX` | contradiction detection | Upper bound                                          |
| `MEMORY_DECAY_INTERVAL_MS`           | decay service           | Decay tick interval                                  |
| `PGVECTOR_TEST_URL`                  | CI integration tests    | Enables pgvector integration tests                   |
| `LTM_QUOTA_TEST_URL`                 | quota integration tests | Test-only Postgres URL                               |
| `ENGRAM_MCP_URL`                     | MCP client config       | Base URL for MCP endpoint                            |

**Total configuration reference scope**: 32 (schema-validated) + ~20 (unvalidated) = **~52 env vars**.

**JSDoc descriptions exist in source** (e.g., `/** Conditional Postgres URL. Required for... */`)
but are not runtime-visible via `z.toJSONSchema()`. The generator will parse them using
the TypeScript compiler API (`ts.createSourceFile` + AST walking) or ts-morph to
extract leading JSDoc comments for each field. Alternatively: migrate descriptions to
Zod `.describe()` calls (one-time refactor, ~32 edits — this is the cleaner long-term
approach; mark as optional in T3).

---

## 3. Tooling evaluation and recommendation

### 3.1 Frameworks evaluated

| Framework           | Type                   | Next 16 compat                                     | MDX               | Static export                 | Monorepo/pnpm  | Search (static)               | Versioning                               | Pages fit                                                                               |
| ------------------- | ---------------------- | -------------------------------------------------- | ----------------- | ----------------------------- | -------------- | ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| **Astro Starlight** | Purpose-built docs SSG | N/A (Astro, not Next)                              | Yes               | Yes (Astro default)           | Yes            | Pagefind (build-time, static) | `starlight-versions` (HiDeoo; early dev) | **Excellent**: pure static, trivially merged                                            |
| **Fumadocs**        | Next.js docs framework | **Yes** (v16 requires Next 16+)                    | Yes               | Yes (needs `output:'export'`) | Yes            | Orama (WASM, works static)    | None built-in                            | **Conditional**: static export OK, but search under basePath needs validation; see §3.3 |
| **Nextra**          | Next.js docs framework | Partial (4.6.1 fixes; early issues with Turbopack) | Yes               | Yes (limited)                 | Yes            | FlexSearch (client-side)      | None built-in                            | Same Pages constraint as Fumadocs                                                       |
| **Docusaurus**      | React SSG (Meta)       | N/A (own React bundler)                            | Yes               | Yes (default SSG)             | Yes (via pnpm) | Algolia + local fallback      | **Built-in (best-in-class)**             | Good: pure static                                                                       |
| **VitePress**       | Vue 3 + Vite SSG       | N/A                                                | Yes (MDC variant) | Yes                           | Yes            | MiniSearch (static)           | None built-in                            | Good: pure static                                                                       |
| **Mintlify**        | Hosted SaaS            | N/A                                                | Yes               | No (SaaS only)                | N/A            | Built-in (hosted)             | Built-in                                 | **No**: requires external hosting, proprietary, $X/month                                |

**Verified facts** (web searches performed 2026-07-05):

- Fumadocs v16 explicitly requires Next.js 16 or later (Next 16 adopted for its canary React channel). Source: fumadocs.dev/blog/v16.
- Nextra v4.6.1 (Dec 2025) fixed Next 16 compatibility. Earlier issues with Turbopack existed. Source: github.com/shuding/nextra/issues/4830.
- Astro Starlight: static-native, Pagefind runs at build time (no external service). ~200K weekly downloads, active 2026. Source: pkgpulse.com/blog/best-documentation-frameworks-2026.
- Docusaurus: ~3M weekly downloads, built-in versioning, Algolia DocSearch (free for OSS). Source: same.
- `starlight-typedoc` v0.21.4 (HiDeoo): confirmed on npm and GitHub. Uses `typedoc-plugin-markdown` to emit Starlight-compatible MDX; requires Astro v5. Source: npmjs.com/package/starlight-typedoc, github.com/HiDeoo/starlight-typedoc.
- `starlight-versions` (HiDeoo): confirmed on npm and GitHub — community plugin, not an official `@astrojs/*` package. Still in early development; frequent API changes expected. Source: github.com/HiDeoo/starlight-versions.

**Assumed (verify in T1)**:

- Pagefind under `base:'/docs'`: Astro's `base` config option is documented, but a GitHub discussion (#1407, withastro/starlight) shows developers needed to patch sidebar/title components for correct base-path handling. May require workaround. If Pagefind search links are not correctly prefixed, fall back to Strategy B (Vercel). Source: github.com/withastro/starlight/discussions/1407.

### 3.2 Pages deployment constraint (discriminating factor)

GitHub Pages hosts exactly one artifact per repository. `apps/marketing-site` already
occupies this slot (CNAME `engram.events`, workflow `node.js.yml`, environment
`github-pages`). A second independent `upload-pages-artifact` + `deploy-pages` would
conflict. Two viable integration strategies:

**Strategy A — Merged artifact under `/docs` subpath**
Both sites build their static output; a workflow step merges them before a single
`upload-pages-artifact`. The docs tool must support a configurable `base` URL:

- `/` → marketing-site
- `/docs/` → docs site (base path: `/docs`)

Next.js (`apps/docs`) supports `basePath: '/docs'` but static export with search
(Fumadocs/Nextra) under a non-root basePath requires verification. Astro Starlight
supports `base: '/docs'` natively and Pagefind respects it.

**Strategy B — Separate host for docs (Vercel)**
Deploy docs to `docs.engram.events` via Vercel. No Pages conflict. Works for any
framework. Requires Vercel account + DNS CNAME change. For an open-source project
that may attract contributors: Vercel free tier is adequate.

**Decision**: Strategy A (merged Pages artifact) is recommended for lowest-friction
self-hosting with no additional accounts. The tooling choice must support it cleanly.
Strategy B is the fallback if the merged artifact approach proves too fragile in CI.

### 3.3 Recommendation: Astro Starlight

**Replace `apps/docs` with an Astro Starlight project. Deploy as a merged artifact
at `/docs` on GitHub Pages (engram.events/docs).**

Rationale:

1. **Pages constraint, cleanly resolved**: Starlight produces pure static HTML. Its
   `base` config option (`base: '/docs'`) is documented and works for content routing.
   Pagefind generates a static search index at build time. **Caveat (assumed, verify in
   T1)**: a Starlight upstream discussion (#1407) indicates that full base-path support
   (sidebar links, site title, Pagefind URLs) may require component patches. If verified
   broken, switch to Strategy B (Vercel). No WASM runtime caveats, no Node.js server
   needed.

2. **No Next.js version friction**: `apps/docs` is throwaway boilerplate. Replacing
   it with Starlight removes one Next.js app from the Turborepo dependency graph and
   avoids the static-export quirks of running `output:'export'` on Fumadocs under a
   non-root basePath (unverified).

3. **Purpose-built for documentation**: Starlight ships a sidebar, nav, breadcrumbs,
   table of contents, dark mode, mobile layout, and Pagefind search — zero custom
   components needed for day-one quality. Fumadocs requires more React component
   wiring for equivalent results.

4. **pnpm monorepo compatible**: Astro runs in pnpm workspaces. Add `apps/docs`
   to `pnpm-workspace.yaml`; run `pnpm --filter docs dev/build` from root.

5. **MDX + content collections**: Starlight uses Astro's Content Collections
   for type-safe MDX. Auto-generated files (env table, tool reference) can be
   `.md` files (valid content sources) that satisfy check-docs frontmatter
   requirements.

6. **TypeDoc integration**: `typedoc-plugin-markdown` + `starlight-typedoc` generates
   Starlight-compatible MDX from TypeScript source. `entryPointStrategy:'packages'`
   supports the monorepo layout natively.

7. **Versioning**: `starlight-versions` plugin (HiDeoo; early dev, verified on npm)
   handles docs versioning when needed. Policy: version at 1.0.0 (currently v0.1.0);
   track main until then.

**Second choice**: Fumadocs — if the team prefers to stay in the Next.js/React
ecosystem and is willing to validate that static export + Pagefind/Orama search
work correctly under `basePath:'/docs'` before committing. Fumadocs v16 is mature
and actively maintained (10K+ GitHub stars as of April 2026). Use it if the Starlight
Turborepo integration proves awkward for any reason.

**Explicitly ruled out**:

- Mintlify: hosted/proprietary, $-per-seat, no self-hosted option.
- Nextra: early Next 16 issues, no built-in versioning, limited static search.
- VitePress: Vue ecosystem, team is React/TypeScript — friction for contributors.
- Docusaurus: excellent but React 18-based (no Next.js re-use), ~3MB JS bundle.

---

## 4. Information architecture (Diátaxis)

Diátaxis organises docs into four quadrants: **Tutorials** (learning-oriented),
**How-to guides** (task-oriented), **Reference** (information-oriented), and
**Explanation** (understanding-oriented). The full sitemap below maps every
Engram concept to a quadrant.

### 4.1 Sitemap

```
/ (root — site landing page, brief what-is + links to quadrants)

/getting-started/                           [TUTORIAL]
  index                                     — Overview: which profile to pick
  /quick-start                              — Memory profile, zero deps, 3 commands
  /installation                             — Enterprise profile full setup
  /first-memory                             — Store, recall, and inspect a memory end-to-end
  /mcp-client-setup                         — Claude Desktop + Claude Code config

/architecture/                              [EXPLANATION]
  index                                     — System overview diagram
  /memory-model                             — Single Memory Prisma model, type field, expiresAt
  /memory-tiers                             — STM (Redis/in-process) vs LTM (Postgres)
  /deployment-profiles                      — memory / lite / enterprise, ProfileCapabilities
  /vector-backends                          — qdrant vs pgvector, when to pick each
  /embeddings                               — openai / local / disabled, Redis caching
  /reindex-backfill                         — Cursor-resumable reindex, queue/cancel/retry
  /auth-and-multitenancy                    — JWT, API keys, scopes, identity/admin/public tools
  /consolidation-and-decay                  — STM→LTM promotion, decay service lifecycle

/how-to/                                    [HOW-TO GUIDE]
  index                                     — Index of operational guides
  /change-vector-backend                    — VECTOR_BACKEND env var, migration notes
  /configure-embeddings                     — Switch providers, disable, local mode
  /reindex-embeddings                       — CLI + MCP tools reindex_memories / queue_reindex
  /backup-and-restore                       — pg_dump, Redis BGSAVE, Qdrant snapshot (migrated)
  /profile-migration                        — Lite → enterprise runbook (migrated from SETUP.md)
  /deploy-production                        — Docker Compose, env file, health checks (migrated)
  /enable-auth                              — AUTH_REQUIRED, JWT_SECRET, OAuth providers
  /enable-observability                     — OTel endpoint, Prometheus metrics (migrated)
  /add-mcp-tool                             — Zod schema → handler → index.ts registration
  /write-evaluations                        — pnpm eval, precision@k / recall@k harness

/reference/                                 [REFERENCE]
  index

  /reference/mcp-tools/                     — AUTO-GENERATED from Zod schemas
    index                                   — Tool table (name, description, auth mode)
    /ping
    /create-memory
    /get-memory
    /list-memories
    /update-memory
    /delete-memory
    /promote-memory
    /recall
    /reindex-memories
    /queue-reindex-memories
    /get-reindex-status
    /cancel-reindex-job
    /retry-reindex-job
    /consolidate-memories
    /remember
    /forget
    /reflect
    /compress-context
    /load-context
    /ingest-conversation
    /prompt-context

  /reference/configuration                  — AUTO-GENERATED env-var table (~52 vars: 32 schema-validated + ~20 process.env)
  /reference/capacity                       — Latency budgets, thresholds (migrated CAPACITY.md)
  /reference/release-gates                  — SLO targets, gate criteria (migrated)
  /reference/health-endpoints              — /health, /health/ready, /health/metrics
  /reference/observability                  — OTel + Prometheus reference (migrated)
  /reference/security                       — OWASP checklist (migrated)
  /reference/security-reviews/
    /2026-07-02                             — Migrated review report

  /reference/api/                           — AUTO-GENERATED via TypeDoc + starlight-typedoc
    index                                   — Package index
    /config
    /core
    /memory-stm
    /memory-ltm
    /memory-lite
    /embeddings
    /vector-store
    /database
    /redis
    /auth
    /eval
    /client

/contributing/                              [HOW-TO + EXPLANATION hybrid]
  index                                     — How to contribute
  /development-setup                        — Local environment, quality checks
  /adding-tools                             — Guide: add an MCP tool end-to-end
  /testing-conventions                      — Service level + wiring level tests
  /commit-style                             — Conventional commits, branch names
  /roadmap                                  — Migrated from docs/roadmap.md
```

**Total pages**: ~65 (21 tool pages + 12 API package pages + ~32 other pages).

### 4.2 Nav structure in Starlight

```yaml
# astro.config.mjs sidebar
sidebar:
  - label: Getting started
    items: [quick-start, installation, first-memory, mcp-client-setup]
  - label: Architecture
    collapsed: true
    items:
      [
        memory-model,
        memory-tiers,
        deployment-profiles,
        vector-backends,
        embeddings,
        reindex-backfill,
        auth-and-multitenancy,
        consolidation-and-decay,
      ]
  - label: How-to guides
    collapsed: true
    autogenerate: { directory: how-to }
  - label: Reference
    items:
      - label: MCP Tools
        autogenerate: { directory: reference/mcp-tools }
      - reference/configuration
      - reference/capacity
      - reference/health-endpoints
      - reference/observability
      - label: Security
        items: [reference/security, reference/security-reviews/2026-07-02]
      - label: API
        autogenerate: { directory: reference/api }
  - label: Contributing
    autogenerate: { directory: contributing }
```

---

## 5. Design decisions

### D1 — docs:check is not extended for MDX

`check-docs.mjs` only processes `.md` files. All hand-written content in the
Starlight site will be `.mdx`; the generated files (env table, tool reference)
will be `.md` so they satisfy frontmatter lint and link checks automatically.
This is intentional: check-docs validating MDX would require a JSX parser.

### D2 — Drift gate is a separate CI step, not part of docs:check

The mechanism for "docs fail build when they drift from code" is:

1. `pnpm docs:generate` runs all three generators and writes files to the worktree.
2. A CI step runs `git diff --exit-code -- apps/docs/src/content/` to catch uncommitted drift.
3. Developers run `pnpm docs:generate` locally before committing (added to a git
   pre-commit hook, or at minimum documented in CONTRIBUTING).

`check-docs.mjs` is NOT modified; it continues to validate `.md` frontmatter and links.

### D3 — Generated files are committed to the repo

Generators run at `pnpm build` time but the output is committed. Rationale: this
allows the `git diff --exit-code` drift gate in D2, makes generated content
searchable in GitHub's code search, and avoids a docs-build dependency on the full
TypeScript compilation during static site generation. Generated files are marked
`# AUTO-GENERATED — do not edit by hand` in a comment/frontmatter field.

**Determinism requirement**: Generators MUST NOT emit timestamps, "generated on YYYY-MM-DD"
lines, run-IDs, or any other non-deterministic content. Any such output causes the
drift gate to fail spuriously on every CI run (the committed file will always differ
from the freshly generated one). Use a fixed comment: `<!-- AUTO-GENERATED -->` only.

### D4 — baseSchema must be exported from @engram/config

`envSchema` is a `ZodEffects` (result of `.transform()`), not introspectable as a
`ZodObject`. The env-table generator must call `z.toJSONSchema(baseSchema, {io:'input'})`.
This requires `export const baseSchema` to be added to `packages/config/src/env.schema.ts`
and re-exported from `packages/config/src/index.ts`. This is a **small code change**
(no behaviour change — purely an export addition). Task T3 owns this.

### D5 — JSDoc descriptions extracted via ts-morph (not Zod .describe())

Migrating all 32 env var field comments to `.describe()` is correct long-term but
is a refactor out of scope for this documentation WP. The generator (T3) will use
`ts-morph` (or `typescript` compiler API directly) to extract leading JSDoc block
comments from `baseSchema`'s object literal. This gives accurate descriptions
immediately without modifying the schema. A follow-up task can migrate to `.describe()`.

### D6 — TypeDoc produces Markdown via typedoc-plugin-markdown + starlight-typedoc

TypeDoc's default output is standalone HTML; this conflicts with Starlight's own
HTML. Instead:

- `typedoc` + `typedoc-plugin-markdown` generates `.md` files per symbol.
- `starlight-typedoc` integrates these as a Starlight content collection under
  `/reference/api/`.
- `entryPointStrategy: 'packages'` in `typedoc.json` discovers all `packages/*/`
  entries from `pnpm-workspace.yaml`.

### D7 — No versioning at launch; version at 1.0.0

ENGRAM is v0.1.x. Maintaining a parallel "v0.1" and "v0.2" docs version adds
overhead for no user benefit at this stage. Policy: docs track `main` with a
"Last updated" date in the footer. Version the docs site at 1.0.0 using
`starlight-versions` (npm-verified; note: still in early development with
frequent API changes expected).

### D8 — apps/docs is replaced, not extended

The current `apps/docs` Next.js boilerplate has zero content. The executor will
delete `apps/docs/app/`, `apps/docs/public/`, `apps/docs/next.config.js`,
`apps/docs/eslint.config.js`, and replace `apps/docs/package.json` with an Astro
Starlight project. The `apps/docs` directory name is preserved so AGENTS.md and
pnpm filter scripts continue to work.

### D9 — docs:generate added as root pnpm script; Turbo task optional

`pnpm docs:generate` runs all three generators sequentially:

```jsonc
// root package.json
"docs:generate": "node scripts/gen-env-table.mjs && node scripts/gen-mcp-tools.mjs && node scripts/gen-typedoc.mjs"
```

Turbo task `"docs:generate"` is optional — add it if caching speed matters. The
CI drift-gate step runs `pnpm docs:generate` then `git diff --exit-code`.

### D10 — Stubs in docs/ preserve inbound links from AGENTS.md / CLAUDE.md

After migrating each `docs/*.md` file's content into the Starlight site:

- The original file is replaced with a one-paragraph stub: `See [ENGRAM Docs](https://engram.events/docs/...)`.
- The stub retains its YAML frontmatter so check-docs passes.
- AGENTS.md line 116 (`docs/SETUP.md`) continues to resolve.

---

## 6. Work breakdown

Tasks are labeled S (≤ 1 day), M (1–3 days), L (3–5 days). Content tasks are
designed to run in parallel once T1 (scaffold) and T3/T4 (generators) are done.

---

### T1 — Scaffold Astro Starlight in apps/docs

**Size**: L  
**Depends on**: nothing  
**Owner**: one executor

**Description**: Replace the Next.js boilerplate in `apps/docs` with a working
Astro Starlight project. Configure pnpm workspace, Turborepo, basePath, and local dev.

**Steps**:

1. Remove Next.js-specific files from `apps/docs`:
   - `apps/docs/app/` (entire directory)
   - `apps/docs/public/` (Turborepo/Vercel SVG assets)
   - `apps/docs/next.config.js`
   - `apps/docs/eslint.config.js`
   - `apps/docs/tsconfig.json`
2. Run inside `apps/docs/`:
   ```bash
   pnpm create astro@latest . -- --template starlight --no-git --no-install
   ```
   Accept defaults. Choose TypeScript strict.
3. Update `apps/docs/package.json`:
   - Name: `"docs"` (preserve — AGENTS.md refers to `--filter docs`)
   - Add `"build": "astro build"`, `"dev": "astro dev --port 3001"`,
     `"check-types": "astro check"`, `"preview": "astro preview"`
   - Remove Next.js deps; add `astro`, `@astrojs/starlight`, `sharp`,
     `starlight-links-validator` (install now; configure below)
4. Configure `apps/docs/astro.config.mjs`:
   ```js
   import starlightLinksValidator from 'starlight-links-validator';
   base: '/docs',
   site: 'https://engram.events',
   integrations: [starlight({
     title: 'Engram Docs',
     plugins: [starlightLinksValidator()],
     // ... other config
   })]
   ```
   `starlight-links-validator` fails the Astro build on broken internal links — this
   is the standing CI gate for `.mdx` content (which `pnpm docs:check` does not cover).
5. Verify `pnpm --filter docs build` succeeds from repo root.
6. Update `turbo.json` to add `docs:generate` as a pipeline task if caching needed.
7. Update `apps/docs/README.md` with Starlight-specific dev instructions.
8. Add `"docs:generate"` script to root `package.json` (placeholder for T3/T4).
9. Verify base-path Pagefind behaviour: run `pnpm --filter docs preview` and check
   that search results return URLs prefixed with `/docs/`. If broken, open a tracking
   comment in T2 and switch Strategy A → Strategy B (Vercel deploy).
10. Run `pnpm docs:check` from root — must pass (no new .md files yet that lack frontmatter).

**Acceptance criteria**:

- `pnpm --filter docs build` exits 0, producing `apps/docs/dist/`
- `pnpm --filter docs dev` serves `http://localhost:3001/docs/` with Starlight default page
- `pnpm docs:check` exits 0
- `pnpm build` (Turbo full build) exits 0
- `starlight-links-validator` is wired in `astro.config.mjs` (build fails on broken internal links)
- Pagefind base-path verified: search results under `/docs` return URLs prefixed with `/docs/`

**Verification**: Run all four commands above. Check `apps/docs/dist/index.html` exists.

---

### T2 — Update GitHub Pages deploy workflow for merged artifact

**Size**: M  
**Depends on**: T1  
**Owner**: one executor

**Description**: Extend `.github/workflows/node.js.yml` so the docs site builds
and merges under `marketing-site/dist/docs/` before the single `upload-pages-artifact`
step. Also add the CI drift-gate step.

**Steps**:

1. In `.github/workflows/node.js.yml`, add a `build-docs` step before
   `upload-pages-artifact` in the `verify` job:
   ```yaml
   - name: Setup pnpm (for docs build)
     uses: pnpm/action-setup@v2
     with:
       version: 11.5.0
   - name: Install docs dependencies
     working-directory: apps/docs
     run: pnpm install --frozen-lockfile
   - name: Build docs site
     working-directory: apps/docs
     run: pnpm build
   - name: Merge docs into marketing-site dist
     run: |
       mkdir -p apps/marketing-site/dist/docs
       cp -r apps/docs/dist/* apps/marketing-site/dist/docs/
   ```
2. The existing `upload-pages-artifact` step already uploads `apps/marketing-site/dist`;
   after the copy above, `dist/docs/` is included automatically.
3. Add a drift-gate job (or step within the existing `test` job in `ci.yml`):
   ```yaml
   - name: Check docs drift
     run: |
       pnpm docs:generate
       git diff --exit-code -- apps/docs/src/content/reference/
   ```
   This step runs `pnpm docs:generate` and fails if the generated files differ from
   what is committed. Requires T3, T4, T5 to be completed first; add this step only
   after those tasks land.

**Acceptance criteria**:

- On a PR touching `apps/docs/**` or `apps/marketing-site/**`, both `verify` and
  the build-docs step pass.
- `apps/marketing-site/dist/docs/index.html` exists after the workflow runs.
- The drift-gate step exits 0 when generators are up-to-date.

**Verification**: Push a docs-only change to a branch and inspect the Pages preview
artifact in the `verify` job's artifact logs.

---

### T3 — Auto-gen: env-var table generator

**Size**: S  
**Depends on**: T1 (for output path)  
**Owner**: one executor

**Description**: Write `scripts/gen-env-table.mjs`. It reads
`packages/config/src/env.schema.ts` via ts-morph, extracts field names, types,
defaults, and leading JSDoc comments from `baseSchema`, and writes
`apps/docs/src/content/docs/reference/configuration.md`.

**Steps**:

1. Export `baseSchema` from `packages/config/src/env.schema.ts`:
   ```ts
   // before the existing envSchema line:
   export { baseSchema };
   ```
   And from `packages/config/src/index.ts`:
   ```ts
   export { baseSchema } from './env.schema';
   ```
2. Write `scripts/gen-env-table.mjs`:
   - Use `ts-morph` (add to root devDependencies: `pnpm add -D ts-morph`).
   - Open `packages/config/src/env.schema.ts` with ts-morph.
   - Find the `baseSchema` variable declaration.
   - Walk its `z.object({...})` argument, extracting each property:
     - Key name → `Variable`
     - Zod type chain → `Type` column (e.g., `string`, `number`, `boolean`, `enum(...)`)
     - `.default(...)` call → `Default`
     - `.optional()` presence → Required column
     - Leading JSDoc block comment → `Description`
   - Also call `z.toJSONSchema(baseSchema, {io:'input'})` at runtime (import the
     compiled `@engram/config`) to cross-check types and defaults.
   - Emit `apps/docs/src/content/docs/reference/configuration.md` with:
     - YAML frontmatter: `title: Configuration Reference`, `description: All ENGRAM environment variables with types, defaults, and profile requirements`
     - **Section 1 — Schema-validated table** (32 rows): `| Variable | Type | Default | Required | Profile | Description |`
     - Profile-conditional notes for DATABASE_URL, REDIS_URL, QDRANT_URL, JWT_SECRET extracted from the transform logic's `ctx.addIssue` call messages.
     - **Section 2 — "Additional variables (not schema-validated)"** table: enumerate the ~20 `process.env.*` vars found outside `baseSchema` (full list in §2.5), labelled "manual" to signal they require manual upkeep when code changes. See §2.5 for the complete enumeration.
   - **Determinism requirement** (per D3): do NOT emit a "generated on" date or any run-specific content. Output must be byte-for-byte identical on every run or the drift gate will fail spuriously on every CI run.
3. Add `"docs:generate": "node scripts/gen-env-table.mjs && node scripts/gen-mcp-tools.mjs && node scripts/gen-typedoc.mjs"` to root `package.json`.
4. Run `pnpm docs:generate` and verify `configuration.md` has 32 rows in section 1 and ~20 rows in section 2.
5. Run `pnpm docs:check` — the generated `.md` must pass frontmatter + link checks.

**Acceptance criteria**:

- `configuration.md` has 32 rows in the schema-validated table AND a supplementary table for ~20 additional `process.env` vars (covering `MCP_ADMIN_TOKEN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and the rest listed in §2.5). Total coverage: ~52 vars.
- Frontmatter has `title` and `description`.
- No broken links in the generated file.
- `pnpm docs:check` exits 0.
- `pnpm --filter docs build` exits 0 with the generated file in place.

**Verification**: `pnpm docs:generate && pnpm docs:check && pnpm --filter docs build`

---

### T4 — Auto-gen: MCP tool reference generator

**Size**: M  
**Depends on**: T1 (output path), T3 (pnpm docs:generate script stub)  
**Owner**: one executor

**Description**: Write `scripts/gen-mcp-tools.mjs`. It imports all 21 tool schemas,
calls `zodToJsonSchema()` from `@engram/core`, and emits one MDX/MD page per tool
under `apps/docs/src/content/docs/reference/mcp-tools/`.

**Steps**:

1. The generator must handle two source locations:
   - `pingTool` from `packages/core/src/mcp/tools/ping.tool.ts` (already exported)
   - 20 tools from `apps/mcp-server/src/memory/memory.controller.ts` (inline objects
     at lines 1078–1257 of the registration array). **Strategy**: import the compiled
     controller's tool registration via a thin extraction shim (or parse source with
     ts-morph) to get `{ name, description, inputSchema, auth }` for each tool.

     Preferred approach: create `apps/mcp-server/src/memory/tools-manifest.ts` that
     exports the tools array (the `getTools()` call in the controller, extracted as
     a pure function with no NestJS DI). The generator imports the compiled manifest.

2. For each tool, call `zodToJsonSchema(tool.inputSchema)` (re-using the existing
   function from `packages/core/src/mcp/tools/index.ts`).

3. Emit `apps/docs/src/content/docs/reference/mcp-tools/<tool-slug>.md`:

   ```markdown
   ---
   title: create_memory
   description: Create a new memory in the ENGRAM store
   ---

   ## create_memory

   **Auth mode**: `identity`  
   **Required scope**: `memories:write`

   ### Input parameters

   | Parameter | Type                        | Required | Default      | Description                                                  |
   | --------- | --------------------------- | -------- | ------------ | ------------------------------------------------------------ |
   | userId    | string                      | yes      | —            | Tenant ID (injected from auth token when AUTH_REQUIRED=true) |
   | content   | string                      | yes      | —            | Memory content text                                          |
   | type      | 'short-term' \| 'long-term' | no       | 'short-term' | Memory tier                                                  |
   | ...etc    |

   ### Response

   Returns the created Memory object (id, content, type, createdAt, ...).

   ### Example

   \`\`\`json
   {
   "name": "create_memory",
   "arguments": { "userId": "qp", "content": "Prefer TypeScript strict mode" }
   }
   \`\`\`
   ```

4. Emit `apps/docs/src/content/docs/reference/mcp-tools/index.md` with a table of
   all 21 tools (name, description, auth mode, required scope).

5. Add the generator to `pnpm docs:generate` (already stubbed in T3 step 3).

**Acceptance criteria**:

- 22 files generated (1 index + 21 tool pages).
- All have valid frontmatter.
- `pnpm docs:check` exits 0 (broken links would catch typos in cross-references).
- `pnpm --filter docs build` exits 0.
- Tool input tables match what `tools/list` returns at runtime (validated by running
  the MCP server in `profile-memory` + listing tools — or cross-checked against
  the JSON schema in the DTO files).

**Verification**: `pnpm docs:generate && pnpm docs:check && pnpm --filter docs build`

---

### T5 — Auto-gen: TypeDoc integration

**Size**: M  
**Depends on**: T1, T3 (docs:generate script)  
**Owner**: one executor

**Description**: Wire TypeDoc with `typedoc-plugin-markdown` and `starlight-typedoc`
to generate per-package API reference pages under `reference/api/`.

**Steps**:

1. Add to root devDependencies:
   ```bash
   pnpm add -D typedoc typedoc-plugin-markdown starlight-typedoc
   ```
2. Create `typedoc.json` at repo root:
   ```json
   {
     "entryPointStrategy": "packages",
     "entryPoints": [
       "packages/config",
       "packages/core",
       "packages/memory-stm",
       "packages/memory-ltm",
       "packages/memory-lite",
       "packages/embeddings",
       "packages/vector-store",
       "packages/database",
       "packages/redis",
       "packages/auth",
       "packages/eval",
       "packages/client"
     ],
     "out": "apps/docs/src/content/docs/reference/api",
     "plugin": ["typedoc-plugin-markdown"],
     "gitRevision": "main"
   }
   ```
3. Configure `starlight-typedoc` in `apps/docs/astro.config.mjs`:
   ```js
   import starlightTypedoc from 'starlight-typedoc';
   starlight({
     plugins: [starlightTypedoc({ output: 'reference/api', entryPoints: [...], tsconfig: '../../tsconfig.json' })]
   })
   ```
4. Write `scripts/gen-typedoc.mjs`:
   ```js
   import { execSync } from 'node:child_process';
   execSync('npx typedoc', { stdio: 'inherit' });
   ```
5. Run `pnpm docs:generate` and verify 12 package directories appear under
   `apps/docs/src/content/docs/reference/api/`.
6. Run `pnpm --filter docs build` — verify no Astro build errors from TypeDoc output.

**Notes**:

- NestJS services use decorators. TypeDoc handles TS decorators but may emit
  NestJS-specific symbols (`@Injectable()`, `@Module()`) as noisy entries. Add
  `excludePrivate: true` and `excludeInternal: true` to `typedoc.json`.
- `@engram/eval` has 14 exports including benchmark types; these are useful API
  reference for custom eval harnesses.

**Acceptance criteria**:

- 12 subdirectories under `reference/api/`, each with at least one `.md` file.
- `pnpm docs:check` exits 0 on generated files (all have frontmatter via plugin).
- `pnpm --filter docs build` exits 0.
- `git diff --exit-code -- apps/docs/src/content/docs/reference/api/` exits 0 after
  a clean `pnpm docs:generate` run (files are stable).

**Verification**: `pnpm docs:generate && pnpm --filter docs build`

---

### T6 — Wire drift gate into CI

**Size**: S  
**Depends on**: T3, T4, T5, T2  
**Owner**: one executor

**Description**: Add the docs drift-gate step to CI so that any code change that
makes a generator's output differ from the committed files fails the build.

**Steps**:

1. In `.github/workflows/ci.yml`, add after the `Check docs` step:
   ```yaml
   - name: Generate docs (drift check)
     run: |
       pnpm docs:generate
       git diff --exit-code -- apps/docs/src/content/docs/reference/ \
         || (echo "ERROR: generated docs are out of date. Run 'pnpm docs:generate' and commit." && exit 1)
   ```
2. Add `pnpm docs:generate` to the pre-commit hook (`.husky/pre-commit`):
   ```bash
   pnpm docs:generate
   git add apps/docs/src/content/docs/reference/configuration.md \
           apps/docs/src/content/docs/reference/mcp-tools/ \
           apps/docs/src/content/docs/reference/api/
   ```
   Or document it in the contributing guide as a manual step (less brittle).
3. Verify the CI step does NOT run `pnpm docs:generate` before installing deps —
   ensure `pnpm install --frozen-lockfile` runs first in the same job.

**Acceptance criteria**:

- `pnpm docs:generate && git diff --exit-code -- apps/docs/src/content/docs/reference/`
  exits 0 after generators produce stable output (idempotent).
- A PR that modifies a DTO (e.g., adds a field to `create-memory.dto.ts`) without
  re-running the generator will be caught by CI.

**Verification**: Manually modify a DTO and run the drift check script; confirm exit code 1.

---

### T7a — Migrate operational docs: deploy + backup + release gates

**Size**: M  
**Depends on**: T1 (scaffold provides target directory structure)  
**Can run in parallel with**: T7b, T8, T9, T10  
**Owner**: one executor

**Description**: Migrate `docs/deploy.md`, `docs/ops/backup-runbook.md`, and
`docs/RELEASE_GATES.md` into the Starlight site. Replace originals with stubs.

**Files to create**:

- `apps/docs/src/content/docs/how-to/deploy-production.mdx` — from `docs/deploy.md` (239 lines)
- `apps/docs/src/content/docs/how-to/backup-and-restore.mdx` — from `docs/ops/backup-runbook.md`
- `apps/docs/src/content/docs/reference/release-gates.md` — from `docs/RELEASE_GATES.md` (162 lines)

**Stub replacement**:
Each original file becomes:

```markdown
---
title: [original title]
description: [original description]
---

This page has moved. See the [ENGRAM Developer Docs](https://engram.events/docs/...).
```

**Acceptance criteria**:

- All three new `.mdx` files have valid YAML frontmatter.
- Original `docs/*.md` stubs pass `pnpm docs:check`.
- `pnpm --filter docs build` exits 0.
- No broken relative links in the migrated content (relative paths updated for new location).

**Verification**: `pnpm docs:check && pnpm --filter docs build`

---

### T7b — Migrate observability, capacity, security, and review docs

**Size**: M  
**Depends on**: T1  
**Can run in parallel with**: T7a, T8, T9, T10  
**Owner**: one executor

**Description**: Migrate `docs/observability.md`, `docs/CAPACITY.md`,
`docs/security/owasp-checklist.md`, and `docs/reviews/2026-07-02-security-functionality-review.md`.

**Files to create**:

- `apps/docs/src/content/docs/how-to/enable-observability.mdx`
- `apps/docs/src/content/docs/reference/capacity.md`
- `apps/docs/src/content/docs/reference/observability.md`
- `apps/docs/src/content/docs/reference/security.md`
- `apps/docs/src/content/docs/reference/security-reviews/2026-07-02.md`

**Acceptance criteria**: Same as T7a.

---

### T8 — Write Getting Started section (Tutorials)

**Size**: M  
**Depends on**: T1  
**Can run in parallel with**: T7a, T7b, T9, T10  
**Owner**: one executor

**Description**: Write four tutorial pages. These should be optimised for
first-time experience: every command is copy-pasteable, no prior knowledge assumed.
Migrate the three-profile setup from `docs/SETUP.md` but restructure as tutorials.

**Files to create**:

- `apps/docs/src/content/docs/getting-started/index.mdx` — profile picker
- `apps/docs/src/content/docs/getting-started/quick-start.mdx` — memory profile,
  3 commands to running server
- `apps/docs/src/content/docs/getting-started/installation.mdx` — enterprise profile
  (from SETUP.md §Enterprise Profile)
- `apps/docs/src/content/docs/getting-started/first-memory.mdx` — call `create_memory`,
  `recall`, `get_memory` via curl or MCP Inspector
- `apps/docs/src/content/docs/getting-started/mcp-client-setup.mdx` — Claude Desktop
  and Claude Code config (from SETUP.md §MCP Client Setup)

Replace `docs/SETUP.md` with a stub after content migration.

**Acceptance criteria**:

- All files have frontmatter.
- All commands in code blocks are syntactically correct (cross-checked against
  CLAUDE.md and root package.json scripts).
- `pnpm docs:check` exits 0; `pnpm --filter docs build` exits 0.

**Verification**: `pnpm docs:check && pnpm --filter docs build`

---

### T9 — Write Architecture section (Explanation)

**Size**: M  
**Depends on**: T1  
**Can run in parallel with**: T7a, T7b, T8, T10  
**Owner**: one executor

**Description**: Write eight explanation pages covering Engram's internal design.
These pages explain _why_ things work the way they do, not how to operate them.
References must point to real source locations.

**Files to create** (all `.mdx`):

- `getting-started/index.mdx` — already in T8; skip
- `architecture/index.mdx` — one-paragraph overview + system diagram (Mermaid)
- `architecture/memory-model.mdx` — `prisma/schema.prisma` Memory model walkthrough
- `architecture/memory-tiers.mdx` — STM (Redis TTL / in-process) vs LTM (Postgres),
  consolidation threshold (`STM_CONSOLIDATION_ACCESS_THRESHOLD`), decay
- `architecture/deployment-profiles.mdx` — memory/lite/enterprise, `ProfileCapabilities`,
  `packages/config/src/profile.ts`
- `architecture/vector-backends.mdx` — qdrant vs pgvector, `VECTOR_BACKEND`, trade-offs
- `architecture/embeddings.mdx` — three providers, Redis caching, null-safe fallback
- `architecture/reindex-backfill.mdx` — cursor-resumable algorithm, queue/retry/cancel
- `architecture/auth-and-multitenancy.mdx` — JWT, API keys, `ToolAuthMode`, `resolveActingUserId`,
  scope enforcement, delegable tools
- `architecture/consolidation-and-decay.mdx` — `ConsolidationService`, `DecayService`,
  lifecycle hooks

**Acceptance criteria**: All files have frontmatter; `pnpm docs:check` exits 0;
`pnpm --filter docs build` exits 0.

---

### T10 — Write How-to guides section

**Size**: M  
**Depends on**: T1  
**Can run in parallel with**: T7a, T7b, T8, T9  
**Owner**: one executor

**Description**: Write task-oriented how-to guides for operational and developer tasks.

**Files to create** (all `.mdx`):

- `how-to/index.mdx` — index table
- `how-to/change-vector-backend.mdx`
- `how-to/configure-embeddings.mdx`
- `how-to/reindex-embeddings.mdx` — CLI + MCP admin tools
- `how-to/profile-migration.mdx` — migrate from SETUP.md §Profile-to-Profile Migration
- `how-to/enable-auth.mdx` — AUTH_REQUIRED, JWT_SECRET, OAuth providers
- `how-to/add-mcp-tool.mdx` — step-by-step: Zod schema → handler → index.ts registration
- `how-to/write-evaluations.mdx` — `packages/eval`, `pnpm eval` harness
- `how-to/run-load-test.mdx` — `scripts/load-test.mjs`

Note: `deploy-production`, `backup-and-restore`, `enable-observability` are handled
in T7a/T7b.

**Acceptance criteria**: All files have frontmatter; `pnpm docs:check` exits 0;
`pnpm --filter docs build` exits 0.

---

### T11 — Write MCP Tools reference (manual layer on top of auto-gen)

**Size**: S  
**Depends on**: T4 (auto-gen produces stubs)  
**Owner**: one executor

**Description**: Review auto-generated tool pages, add prose descriptions, usage
notes, and worked examples. The generator (T4) produces parameter tables; this
task adds the "why and when to call this tool" prose.

**Focus tools** (most complex; simple tools need only a usage example):

- `recall` — hybrid vector + lexical scoring, query syntax, score threshold
- `consolidate_memories` — trigger criteria, consolidation algorithm
- `reindex_memories` / `queue_reindex_memories` / `get_reindex_status` — admin
  tools, `MCP_ADMIN_TOKEN` requirement, cursor-resumable semantics
- `compress_context` / `load_context` / `prompt_context` — context window management
- `remember` / `forget` / `reflect` — high-level wrappers vs raw CRUD

**Acceptance criteria**:

- Each of the 10 focus tool pages has ≥ 1 prose paragraph explaining when to use it.
- `pnpm docs:check` exits 0; `pnpm --filter docs build` exits 0.

---

### T12 — Write Configuration reference (manual layer on top of auto-gen)

**Size**: S  
**Depends on**: T3 (auto-gen produces the table)  
**Owner**: one executor

**Description**: Add profile-conditional requirement notes and usage tips to the
generated `configuration.md`. The auto-gen table covers types and defaults; this
task adds a "Profile requirements" section and annotated examples for common setups.

**Content to add**:

1. Profile requirements matrix (which vars are required per profile)
2. Example `.env` snippets for each profile
3. Security notes: `JWT_SECRET`, `MCP_ADMIN_TOKEN`, `LOCAL_ENCRYPTION_KEY`
4. Tuning notes: `PGVECTOR_HNSW_*`, `STM_CONSOLIDATION_*`, rate-limit vars

**Acceptance criteria**: `pnpm docs:check` exits 0; `pnpm --filter docs build` exits 0.

---

### T13 — Write Contributing section

**Size**: S  
**Depends on**: T1  
**Can run in parallel with**: T7a, T7b, T8, T9, T10  
**Owner**: one executor

**Description**: Write the contributing guide pages.

**Files to create**:

- `contributing/index.mdx` — overview + code of conduct pointer
- `contributing/development-setup.mdx` — from AGENTS.md + CLAUDE.md; copy-pasteable commands
- `contributing/adding-tools.mdx` — mirrors T10's `how-to/add-mcp-tool.mdx` but for contributors
- `contributing/testing-conventions.mdx` — service-level + wiring-level, coverage thresholds
- `contributing/commit-style.mdx` — conventional commits, branch examples from AGENTS.md
- `contributing/roadmap.mdx` — migrated from `docs/roadmap.md` (with stub replacement)

**Acceptance criteria**: All have frontmatter; `pnpm docs:check` exits 0;
`pnpm --filter docs build` exits 0.

---

### T14 — Full link check, local preview, and acceptance gate

**Size**: S  
**Depends on**: T7a, T7b, T8, T9, T10, T11, T12, T13, T3, T4, T5  
**Owner**: one executor

**Description**: Run the full acceptance suite for all docs tasks combined.

**Steps**:

1. `pnpm docs:generate` — regenerate all auto-gen content.
2. `pnpm docs:check` — must exit 0.
3. `pnpm --filter docs build` — must exit 0 with no warnings.
4. Install and run `lychee` or `linkinator` on `apps/docs/dist/` to check
   external links (GitHub repo links, API service links):
   ```bash
   npx linkinator apps/docs/dist/ --recurse --skip "^(?!https://engram.events)" --skip "localhost"
   ```
5. `pnpm --filter docs preview` — serve `apps/docs/dist/` at localhost:3001/docs/;
   manually verify sidebar, search (Pagefind), dark mode, and mobile layout.
6. Run `git diff --exit-code -- apps/docs/src/content/docs/reference/` to confirm
   no uncommitted generated changes remain.
7. Verify each `docs/*.md` stub passes `pnpm docs:check` (frontmatter retained).
8. Verify `AGENTS.md` link to `docs/SETUP.md` resolves (stub file exists).

**Acceptance criteria**:

- `pnpm docs:check` exits 0.
- `pnpm --filter docs build` exits 0.
- No broken internal links in `apps/docs/dist/`.
- Pagefind search returns relevant results for "recall" and "create_memory".
- All `docs/*.md` stubs link to the new docs URL.
- Drift-gate script exits 0.

---

## 7. Dependency graph

```
T1 (scaffold) ──────────────────────────────────────────────────────────────┐
  │                                                                          │
  ├── T3 (env gen) ─────────────────────────────────────────────────────────┤
  │     │                                                                    │
  │     └── T12 (config reference polish)                                   │
  │                                                                          │
  ├── T4 (tool gen) ────────────────────────────────────────────────────────┤
  │     │                                                                    │
  │     └── T11 (tool reference polish)                                     │
  │                                                                          │
  ├── T5 (TypeDoc) ─────────────────────────────────────────────────────────┤
  │                                                                          │
  ├── T7a (migrate ops docs) ── parallel ──────────────────────────────────┤
  ├── T7b (migrate security docs) ── parallel ─────────────────────────────┤
  ├── T8 (getting started) ── parallel ────────────────────────────────────┤
  ├── T9 (architecture) ── parallel ───────────────────────────────────────┤
  ├── T10 (how-to guides) ── parallel ─────────────────────────────────────┤
  └── T13 (contributing) ── parallel ──────────────────────────────────────┤
                                                                             │
T2 (Pages workflow) ─── depends T1 ──────────────────────────────────────── │
                                                                             │
T3 + T4 + T5 ─── T6 (drift gate) ──────────────────────────────────────── ─┤
                                                                             │
All above ──────────────────────────────── T14 (acceptance gate) ───────────┘
```

**Parallel execution path** (fastest path to shippable docs site):

Wave 1 (unblock immediately): T1
Wave 2 (all parallel after T1): T3, T4, T5, T7a, T7b, T8, T9, T10, T13
Wave 3 (after T3/T4/T5): T11, T12, T6
Wave 4 (after T1): T2
Wave 5 (after all): T14

With 4 parallel executors: T1 (1 day) → T3+T4+T5+T7a (2 days) → T6+T11+T12+T7b+T8+T9+T10+T13 (2 days) → T2+T14 (1 day). **Estimated total wall-clock: ~6 days of parallel work.**

---

## 8. Risks and open questions

### R1 — Starlight + Turborepo cache integration (MEDIUM)

Astro is not a Turbo-native framework. The Turborepo `build` task currently caches
`.next/**` for Next apps. Starlight outputs to `dist/`. Update `turbo.json` outputs
for the docs app:

```json
{ "build": { "outputs": ["dist/**", ".next/**", "!.next/cache/**"] } }
```

If Astro's build is slow enough to affect developer DX, add `"docs"` to a separate
Turbo task with no dependents.

### R2 — GitHub Pages merged-artifact approach may break on concurrent deploys (MEDIUM)

If both `apps/marketing-site` and docs changes land on the same commit, the
merged-artifact workflow runs once and produces a single artifact (correct). But if
two PRs land close together and the Pages workflow is still running, the `concurrency:
group: pages` guard cancels the old run — safe, but docs-only changes may not re-trigger
a marketing-site build unnecessarily. **Mitigation**: Extend the `paths:` filter in
`node.js.yml` to include `apps/docs/**`:

```yaml
paths:
  - 'apps/marketing-site/**'
  - 'apps/docs/**'
```

So docs-only pushes also trigger the combined deploy.

### R3 — ts-morph JSDoc extraction may not cover all comment styles (LOW)

Some env var fields use `/** ... */` block comments; others may use `//` line
comments. The generator must handle both. Add a unit test for the generator that
asserts all 32 fields produce a non-empty description.

### R4 — tools-manifest extraction from memory.controller.ts (MEDIUM)

The tool registration array is inside a NestJS `@Controller()` method body
(`getTools()` at L1338+). Extracting it cleanly as a pure function (for the
generator to import) requires refactoring the controller slightly. If this proves
too disruptive, fall back to ts-morph AST extraction of the inline object literals
at L1078–1257. Prefer the refactor; document as optional code change in T4.

### R5 — TypeDoc compatibility with NestJS decorators (LOW)

TypeDoc with `experimentalDecorators: true` handles NestJS DI decorators but may
emit implementation noise (`Module`, `Injectable`, `ConfigService` internal symbols).
Tune with `excludePrivate`, `excludeInternal`, and per-package `exclude` globs.
Run a trial TypeDoc build during T5 and adjust before committing.

### R6 — Pagefind search under /docs basePath (LOW)

Astro + Pagefind works with `base: '/docs'` but requires Pagefind's `baseUrl` to
match. Verify during T1 by building and running `npx pagefind --site dist/` and
checking that search results return URLs prefixed with `/docs/`.

### R7 — docs:check will fail on any new .md file without frontmatter during development (LOW)

Generators emit frontmatter by design. Hand-written `.mdx` files escape check-docs.
But any `.md` file the executor creates temporarily without frontmatter will fail
the CI `Check docs` step. Ensure every committed `.md` has frontmatter, even
mid-PR stubs.

### R8 — pnpm docs:generate is not idempotent if TypeDoc fails (LOW)

If TypeDoc encounters a type error in a package, it may produce partial output that
passes `pnpm docs:check` but misleads readers. Wrap the TypeDoc call in
`gen-typedoc.mjs` with `--validation.invalidLink` turned off (TypeDoc links may
reference Prisma internal types), and add `--skipErrorChecking` for the generation
step (Zod/Prisma generate types not always available without a full build).

---

## Open questions

**OQ1**: Should the docs site live at `engram.events/docs` (merged Pages artifact,
Strategy A) or `docs.engram.events` (Vercel, Strategy B)? Strategy A is the plan's
default, but requires the executor to validate the merged-artifact workflow before
committing. If the Pages merge proves fragile, switch to Vercel — update T2 to
add a `vercel.json` at `apps/docs/` and a separate Vercel deploy step in CI.

**OQ2**: `docs/enterprise-plan.md` (the 10-stream implementation plan) — retire to
avoid confusing external contributors? The plan above calls it retired. Confirm
with qp before deleting; it may be useful as internal context.

**OQ3**: Should `pnpm docs:generate` run in the Turborepo pipeline (as a Turbo
task with proper `inputs`/`outputs`) or remain a root-only script? Turbo would
enable caching (skip generation if DTOs haven't changed), but requires declaring
the generator as a task in `turbo.json` with correct input globs. Recommend adding
after the generators are stable.

**OQ4**: The marketing-site (`apps/marketing-site/app.jsx`) claims "13 MCP tools"
(a stale count — there are now 21). WP1 (Marketing Site Validation) calls this out.
The docs site can link to the auto-generated tool reference as the authoritative count.
Coordinate with WP1 executor.

**OQ5**: Auth-protected tool pages (`reindex_memories`, `queue_reindex_memories`,
etc.) require `MCP_ADMIN_TOKEN` — should the tool reference pages display a
prominent "Admin tool" badge? Recommended: yes. Implement as an Astro component
`<AdminBadge />` in T11.
