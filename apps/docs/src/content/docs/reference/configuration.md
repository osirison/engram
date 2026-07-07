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
| `DATABASE_URL` | string | — | no | `lite`, `enterprise` | Conditional Postgres URL. Required for `lite` and `enterprise` profiles, optional for `memory`. The validation rule is applied in the transform below; we keep the field optional here so the same schema can parse a `memory`-profile environment without forcing an empty string. |
| `REDIS_URL` | string | — | no | `enterprise` | Conditional Redis URL. Required only for `enterprise`. |
| `QDRANT_URL` | string | — | no | `enterprise` | Conditional Qdrant URL. Required only for `enterprise`. |
| `OPENAI_API_KEY` | string | — | no | all | Optional — when absent, embedding generation is silently disabled. |
| `EMBEDDING_PROVIDER` | `openai` \| `disabled` \| `local` | `openai` | no | all | Optional embedding provider selection, defaults to OpenAI. |
| `VECTOR_BACKEND` | `qdrant` \| `pgvector` | `qdrant` | no | all | Vector backend selection. Both `qdrant` and `pgvector` are implemented. |
| `VECTOR_COLLECTION` | string | — | no | all | Optional override for the vector collection/table name. |
| `VECTOR_DIMENSIONS` | number | — | no | all | Optional override for embedding dimensionality (defaults to the provider's model dimension). |
| `MCP_TRANSPORT` | `stdio` \| `streamable-http` | `stdio` | no | all | MCP transport selection: stdio for local clients, streamable-http for Inspector. |
| `STM_CONSOLIDATION_ACCESS_THRESHOLD` | number | `3` | no | all | Number of times an STM memory must be accessed before it qualifies for automatic promotion to LTM. Defaults to 3. |
| `STM_CONSOLIDATION_INTERVAL_MS` | number | `300000` | no | all | How often the consolidation job scans for promotion candidates, in milliseconds. Defaults to 5 minutes. Set to 0 to disable the scheduler. |
| `PGVECTOR_HNSW_M` | number | — | no | all | Optional pgvector HNSW build-time `m` (max connections per layer). |
| `PGVECTOR_HNSW_EF_CONSTRUCTION` | number | — | no | all | Optional pgvector HNSW build-time `ef_construction` (candidate list size). |
| `PGVECTOR_HNSW_EF_SEARCH` | number | — | no | all | Optional pgvector HNSW query-time `ef_search` (recall/latency tuning). |
| `DEPLOYMENT_PROFILE` | `memory` \| `lite` \| `enterprise` | `enterprise` | no | all | Deployment profile ladder: - `memory`     → in-process, zero external services. - `lite`       → requires DATABASE_URL; no Redis/Qdrant. - `enterprise` → requires DATABASE_URL, REDIS_URL, QDRANT_URL. Defaults to `enterprise` for backward compatibility with existing production deployments. |
| `JWT_SECRET` | string | — | no | when `AUTH_REQUIRED=true` | HMAC secret for issuing/verifying session JWTs. Required (≥32 chars) when `AUTH_REQUIRED=true`; otherwise optional. Never logged. |
| `JWT_EXPIRES_IN` | string | `7d` | no | all | JWT lifetime as a duration string (`7d`, `24h`, `30m`, `3600s`) or seconds. |
| `AUTH_REQUIRED` | boolean | `false` | no | all | When true, `/mcp` tool calls must present a valid JWT or API key, and the acting `userId` is derived from that credential — the `userId` in tool input is ignored. Default false preserves the trusted-caller behaviour. Only enforced over the streamable-http transport. |
| `OAUTH_REDIRECT_BASE_URL` | string | — | no | all | Base URL used to build OAuth callback URLs, e.g. `https://api.example.com`. |
| `GITHUB_CLIENT_ID` | string | — | no | all | GitHub OAuth app credentials. Both must be set to enable GitHub login. |
| `GITHUB_CLIENT_SECRET` | string | — | no | all | GitHub OAuth client secret (pairs with `GITHUB_CLIENT_ID`). Never logged. |
| `GOOGLE_CLIENT_ID` | string | — | no | all | Google OAuth app credentials. Both must be set to enable Google login. |
| `GOOGLE_CLIENT_SECRET` | string | — | no | all | Google OAuth client secret (pairs with `GOOGLE_CLIENT_ID`). Never logged. |
| `RATE_LIMIT_ENABLED` | boolean | `false` | no | all | Master switch for the Redis-backed rate limiter (enterprise only). |
| `RATE_LIMIT_WINDOW_SEC` | number | `60` | no | all | Fixed-window length in seconds. Default 60 → the `*_RPM` limits are per minute. |
| `RATE_LIMIT_USER_RPM` | number | `120` | no | all | Max requests per window for an authenticated user. |
| `RATE_LIMIT_ORG_RPM` | number | `6000` | no | all | Max requests per window aggregated across an organization. |
| `RATE_LIMIT_IP_RPM` | number | `60` | no | all | Max requests per window for an unauthenticated client IP. |
| `RATE_LIMIT_TOOL_OVERRIDES` | string | — | no | all | Optional JSON map of per-tool overrides, e.g. `{"reindex_memories":{"limit":2,"windowSeconds":3600}}`. Parsed by the app. |

### Profile requirements

Some variables are optional in the base schema but enforced at load time
depending on the active `DEPLOYMENT_PROFILE`:

- DATABASE_URL must be a valid URL
- REDIS_URL must be a valid URL
- QDRANT_URL must be a valid URL
- JWT_SECRET must be set and at least 32 characters when AUTH_REQUIRED=true

## Additional variables (not schema-validated)

These are read directly from `process.env` and are **not** validated by
`@engram/config`. They are discovered by scanning the source, so a new read
appears here automatically (add a description in the generator).

| Variable | Description |
| -------- | ----------- |
| `ALLOW_UNAUTHENTICATED_HTTP` | Dev-only override that allows unauthenticated streamable-http calls. Never set in production. |
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
| `MEMORY_CONTRADICTION_THRESHOLD` | Lower similarity bound for contradiction detection. |
| `MEMORY_CONTRADICTION_THRESHOLD_MAX` | Upper similarity bound for contradiction detection. |
| `MEMORY_DECAY_INTERVAL_MS` | Interval between importance-decay ticks, in milliseconds. |
| `MEMORY_DUPLICATE_THRESHOLD` | Cosine-similarity threshold above which a new memory is treated as a duplicate. |
| `MEMORY_IMPORTANCE_HALF_LIFE_DAYS` | Half-life (days) for the memory importance decay curve. |
| `METRICS_TOKEN` | Bearer token required to scrape `/health/metrics`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint for traces. Omit to disable OpenTelemetry (no overhead). |
| `OTEL_SERVICE_NAME` | Service name reported to OpenTelemetry. |
| `QDRANT_API_KEY` | Optional API key for an authenticated Qdrant instance. |
| `STM_CONSOLIDATION_IMPORTANCE_THRESHOLD` | Minimum importance an STM memory needs to qualify for promotion. |
| `WEB_DATABASE_URL` | Postgres URL used by the Next.js dashboard (`apps/web`). |

### Test-only variables

Set only to enable integration test suites; never required at runtime.

| Variable | Description |
| -------- | ----------- |
| `E2E_ENABLED` | Enables an integration test suite. |
| `LTM_QUOTA_TEST_URL` | Enables an integration test suite. |
| `LTM_RESTORE_TEST_URL` | Enables an integration test suite. |
| `MEMORY_LINK_TEST_URL` | Enables an integration test suite. |
| `MEMORY_VERSION_TEST_URL` | Enables an integration test suite. |
| `PGVECTOR_TEST_URL` | Enables an integration test suite. |
| `STM_SCAN_TEST_URL` | Enables an integration test suite. |
