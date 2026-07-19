---
title: Configuration reference
description: All Engram environment variables with types, defaults, and profile requirements.
---

<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->

Engram is configured entirely through environment variables. Section 1 lists
the schema-validated variables (parsed by `@engram/config`); Section 2 lists
the remaining variables read directly from `process.env` elsewhere in the
codebase.

## Schema-validated variables

| Variable | Type | Default | Required | Profile | Description |
| -------- | ---- | ------- | -------- | ------- | ----------- |
| `NODE_ENV` | `development` \| `production` \| `test` | `development` | no | all | Runtime environment. Controls dev-only behaviours and log verbosity. |
| `PORT` | number | `3000` | no | all | TCP port the MCP/HTTP server listens on. |
| `DATABASE_URL` | string | — | no | `lite`, `enterprise` | Postgres URL. Required in every profile; the requirement is enforced in the transform below so the error message can name the active profile. |
| `OPENAI_API_KEY` | string | — | no | all | Required only when `EMBEDDING_PROVIDER=openai`; when absent, OpenAI embedding generation is silently disabled. |
| `EMBEDDING_PROVIDER` | `ollama` \| `openai` \| `disabled` \| `local` | `ollama` | no | all | Embedding provider selection. Defaults to `ollama` (local-first, no API key). `openai` requires OPENAI_API_KEY; `local` is a deterministic hash for testing. |
| `EMBEDDING_MODEL` | string | — | no | all | Embedding model id. Defaults per provider: ollama→`nomic-embed-text` (768 dims), openai→`text-embedding-3-small` (1536 dims). Changing it requires a full reindex with recreate+regenerate. |
| `OLLAMA_URL` | string | — | no | all | Base URL of the Ollama server used when `EMBEDDING_PROVIDER=ollama`. Defaults to `http://localhost:11434`. |
| `VECTOR_DIMENSIONS` | number | — | no | all | Optional strict pin for embedding dimensionality. When unset, dimensions are inferred from the model (if known) or from the first generated vector. |
| `MCP_TRANSPORT` | `stdio` \| `streamable-http` | `stdio` | no | all | MCP transport selection: stdio for local clients, streamable-http for Inspector. |
| `STM_CONSOLIDATION_ACCESS_THRESHOLD` | number | `3` | no | all | Number of times an STM memory must be accessed before it qualifies for automatic promotion to LTM. Defaults to 3. |
| `STM_CONSOLIDATION_INTERVAL_MS` | number | `300000` | no | all | How often the consolidation job scans for promotion candidates, in milliseconds. Defaults to 5 minutes. Set to 0 to disable the scheduler. |
| `STM_SWEEP_INTERVAL_MS` | number | `600000` | no | all | How often expired short-term memory rows are bulk-deleted from Postgres, in milliseconds. Hygiene only — every STM read filters on expiry. Defaults to 10 minutes. Set to 0 to disable the scheduler. |
| `AUTH_STORE_SWEEP_INTERVAL_MS` | number | `900000` | no | all | How often expired auth KV rows (sessions, OAuth state, jti denylist) and lapsed rate-limit counters are bulk-deleted, in milliseconds. Hygiene only — reads filter on expiry. Defaults to 15 minutes. 0 disables. |
| `MEMORY_DECAY_INTERVAL_MS` | number | `86400000` | no | all | How often the long-term decay/staleness job scans the corpus, in milliseconds. Defaults to 24h. Set to 0 to disable the scheduler. |
| `MEMORY_DECAY_BATCH_SIZE` | number | `100` | no | all | Rows scanned per decay batch (cursor-resumable). Defaults to 100. |
| `MEMORY_DECAY_STALE_SCORE_THRESHOLD` | number | `0.3` | no | all | Importance score at/below which a memory is marked `stale`. Defaults to 0.3. |
| `MEMORY_DECAY_PRUNE_SCORE_THRESHOLD` | number | `0.15` | no | all | Importance score below which an old, unpinned memory is pruned. Defaults to 0.15. |
| `MEMORY_DECAY_PRUNE_OLDER_THAN_DAYS` | number | `30` | no | all | Minimum age in days before a low-importance memory becomes prune-eligible. Defaults to 30. |
| `MEMORY_DUPLICATE_THRESHOLD` | number | `0.97` | no | all | Cosine similarity at/above which a new write collapses into an existing row. Defaults to 0.97. |
| `MEMORY_CONSOLIDATION_MERGE_THRESHOLD` | number | `0.85` | no | all | Lower bound (inclusive) of the corpus-consolidation near-duplicate merge band `[merge, duplicate)`. Must stay strictly below `MEMORY_DUPLICATE_THRESHOLD` (enforced at boot). Defaults to 0.85. |
| `MEMORY_CONSOLIDATION_INTERVAL_MS` | number | `0` | no | all | How often the corpus-consolidation job (near-duplicate clustering, `consolidate_corpus`) runs, in milliseconds. Defaults to 0 = DISABLED — a scheduled pass merges without review, so the operator must opt in explicitly after inspecting a dry run. |
| `MEMORY_CONTRADICTION_THRESHOLD` | number | `0.8` | no | all | Lower bound of the contradiction similarity band. Defaults to 0.8. |
| `MEMORY_CONTRADICTION_THRESHOLD_MAX` | number | `0.97` | no | all | Upper bound (exclusive) of the contradiction band, below the duplicate zone. Defaults to 0.97. |
| `MEMORY_CONTRADICTION_POLICY` | `supersede` \| `flag` | `flag` | no | all | What happens when a new write contradicts an existing memory: `flag` keeps BOTH rows visible in recall and marks them `contradicted` for review; `supersede` hides the older row from default recall (latest-wins). Defaults to `flag` (conservative — no data is hidden without review). |
| `MEMORY_IMPORTANCE_HALF_LIFE_DAYS` | number | `14` | no | all | Half-life in days for the recency component of importance scoring. Defaults to 14. |
| `IMPORT_ALLOWED_ROOT` | string | — | no | all | Absolute directory the `import_agent_memory` server-side path must resolve into (symlinks resolved). Defaults to the server process home directory when unset. |
| `PGVECTOR_HNSW_M` | number | — | no | all | Optional pgvector HNSW build-time `m` (max connections per layer). |
| `PGVECTOR_HNSW_EF_CONSTRUCTION` | number | — | no | all | Optional pgvector HNSW build-time `ef_construction` (candidate list size). |
| `PGVECTOR_HNSW_EF_SEARCH` | number | — | no | all | Optional pgvector HNSW query-time `ef_search` (recall/latency tuning). |
| `DEPLOYMENT_PROFILE` | `lite` \| `standard` \| `enterprise` | `standard` | no | all | Deployment profile ladder: - `lite`     → single-user; auth/organization stack not wired. - `standard` → default; multi-tenant auth stack. Both require only DATABASE_URL (pgvector lives in Postgres). The legacy `enterprise` value is accepted as an alias for `standard`. |
| `JWT_SECRET` | string | — | no | when `AUTH_REQUIRED=true` | HMAC secret for issuing/verifying session JWTs. Required (≥32 chars) when `AUTH_REQUIRED=true`; otherwise optional. Never logged. |
| `JWT_EXPIRES_IN` | string | `7d` | no | all | JWT lifetime as a duration string (`7d`, `24h`, `30m`, `3600s`) or seconds. |
| `AUTH_REQUIRED` | boolean | `false` | no | all | When true, `/mcp` tool calls must present a valid JWT or API key, and the acting `userId` is derived from that credential — the `userId` in tool input is ignored. Default false preserves the trusted-caller behaviour. Only enforced over the streamable-http transport. |
| `ALLOW_UNAUTHENTICATED_HTTP` | boolean | `false` | no | all | Explicit operator acknowledgement to run a multi-tenant streamable-http server WITHOUT auth (trusted-network posture). Without it such a server refuses to boot in every NODE_ENV. |
| `OAUTH_REDIRECT_BASE_URL` | string | — | no | all | Base URL used to build OAuth callback URLs, e.g. `https://api.example.com`. |
| `GITHUB_CLIENT_ID` | string | — | no | all | GitHub OAuth app credentials. Both must be set to enable GitHub login. |
| `GITHUB_CLIENT_SECRET` | string | — | no | all | GitHub OAuth client secret (pairs with `GITHUB_CLIENT_ID`). Never logged. |
| `GOOGLE_CLIENT_ID` | string | — | no | all | Google OAuth app credentials. Both must be set to enable Google login. |
| `GOOGLE_CLIENT_SECRET` | string | — | no | all | Google OAuth client secret (pairs with `GOOGLE_CLIENT_ID`). Never logged. |
| `RATE_LIMIT_ENABLED` | boolean | `false` | no | all | Master switch for the Postgres-backed rate limiter (standard profile only). |
| `RATE_LIMIT_WINDOW_SEC` | number | `60` | no | all | Fixed-window length in seconds. Default 60 → the `*_RPM` limits are per minute. |
| `RATE_LIMIT_USER_RPM` | number | `120` | no | all | Max requests per window for an authenticated user. |
| `RATE_LIMIT_ORG_RPM` | number | `6000` | no | all | Max requests per window aggregated across an organization. |
| `RATE_LIMIT_IP_RPM` | number | `60` | no | all | Max requests per window for an unauthenticated client IP. |
| `RATE_LIMIT_TOOL_OVERRIDES` | string | — | no | all | Optional JSON map of per-tool overrides, e.g. `{"reindex_memories":{"limit":2,"windowSeconds":3600}}`. Parsed by the app. |

### Profile requirements

Some variables are optional in the base schema but enforced at load time
depending on the active `DEPLOYMENT_PROFILE`:

- DATABASE_URL must be a valid URL
- OLLAMA_URL must be a valid URL including a scheme (e.g. http://localhost:11434)
- JWT_SECRET must be set and at least 32 characters when AUTH_REQUIRED=true

## Additional variables (not schema-validated)

These are read directly from `process.env` and are **not** validated by
`@engram/config`. They are discovered by scanning the source, so a new read
appears here automatically (add a description in the generator).

| Variable | Description |
| -------- | ----------- |
| `AUTH_GITHUB_ID` | GitHub OAuth client id for the dashboard (Auth.js). |
| `AUTH_GITHUB_SECRET` | GitHub OAuth client secret for the dashboard (Auth.js). |
| `AUTH_GOOGLE_ID` | Google OAuth client id for the dashboard (Auth.js). |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret for the dashboard (Auth.js). |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins for the HTTP transport. |
| `ENGRAM_ADMIN_EMAILS` | Comma-separated list of emails granted the admin scope. |
| `ENGRAM_API_KEY` | Pre-shared API key accepted as an alternative to a session JWT. |
| `ENGRAM_DASHBOARD_DEV_AUTH` | Dev-only flag that relaxes dashboard auth for local development. |
| `ENGRAM_DEFAULT_USER_ID` | Fallback `userId` used when `AUTH_REQUIRED=false`. |
| `ENGRAM_MCP_URL` | Base URL of the MCP endpoint used by clients and the dashboard. |
| `ENGRAM_OPERATOR_TENANTS` | Comma-separated tenant allowlist an operator (admin) key may act on. |
| `LOG_LEVEL` | Pino log level: `debug` \| `info` \| `warn` \| `error`. |
| `MCP_ADMIN_TOKEN` | Bearer token gating every admin MCP tool. Security-critical. |
| `METRICS_TOKEN` | Bearer token required to scrape `/health/metrics`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint for traces. Omit to disable OpenTelemetry (no overhead). |
| `OTEL_SERVICE_NAME` | Service name reported to OpenTelemetry. |
| `REDIS_URL` | — |
| `STM_CONSOLIDATION_IMPORTANCE_THRESHOLD` | Minimum importance an STM memory needs to qualify for promotion. |
| `WEB_DATABASE_URL` | Postgres URL used by the Next.js dashboard (`apps/web`). |

### Test-only variables

Set only to enable integration test suites; never required at runtime.

| Variable | Description |
| -------- | ----------- |
| `E2E_ENABLED` | Enables an integration test suite. |
| `LTM_CONSOLIDATION_TEST_URL` | Enables an integration test suite. |
| `LTM_LIFECYCLE_TEST_URL` | Enables an integration test suite. |
| `LTM_QUOTA_TEST_URL` | Enables an integration test suite. |
| `LTM_RESTORE_TEST_URL` | Enables an integration test suite. |
| `MEMORY_IMPORT_CAS_TEST_URL` | Enables an integration test suite. |
| `MEMORY_LINK_TEST_URL` | Enables an integration test suite. |
| `MEMORY_SYNC_TEST_URL` | Enables an integration test suite. |
| `MEMORY_VERSION_TEST_URL` | Enables an integration test suite. |
| `PGVECTOR_TEST_URL` | Enables an integration test suite. |
