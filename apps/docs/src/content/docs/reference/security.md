---
title: Security (OWASP checklist)
description: Security review against the OWASP Top 10 for the ENGRAM MCP server, with dependency-audit triage and the security-controls reference.
---

<!-- Migrated from docs/security/owasp-checklist.md (WP6 T7b). -->

## OWASP Top 10 — 2021 Pass/Triage

Reviewed against ENGRAM `mcp-server` v0.1.0. Run `pnpm audit` for the
current dependency vulnerability report.

| #   | Category                                 | Status     | Notes                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Broken Access Control                    | ✅ Pass    | Admin tools gated by `MCP_ADMIN_TOKEN` via `constantTimeStringEqual` (timing-safe). API keys scoped per user via `ApiKeysModule`. No privilege escalation paths found.                                                                                                                                                    |
| A02 | Cryptographic Failures                   | ✅ Pass    | Secrets (`OPENAI_API_KEY`, `MCP_ADMIN_TOKEN`, `JWT_SECRET`) sourced from env only; `REDACT_PATHS` in `LoggingModule` prevents them from appearing in structured logs. Tokens compared with `timingSafeEqual`.                                                                                                             |
| A03 | Injection                                | ✅ Pass    | All DB queries via Prisma parameterised statements. All MCP tool inputs validated with Zod `.strict()` schemas. No raw SQL concatenation. No dynamic `eval` or command execution.                                                                                                                                         |
| A04 | Insecure Design                          | ✅ Pass    | Separation of concern between STM/LTM tiers; profile-aware module wiring enforces capability boundaries.                                                                                                                                                                                                                  |
| A05 | Security Misconfiguration                | ✅ Pass    | Helmet middleware adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `X-XSS-Protection`. CORS restricted to defined origins and methods. Body size limit 4 MB. `X-Powered-By` removed. Content-Security-Policy omitted intentionally (API-only server; no HTML responses). |
| A06 | Vulnerable & Outdated Components         | ⚠️ Triaged | 5 remaining findings — all devDependency or build-tool paths; none reachable in production runtime. See **Audit Triage** below.                                                                                                                                                                                           |
| A07 | Identification & Authentication Failures | ✅ Pass    | Admin token required for all destructive admin tools. API key management with proper CRUD. JWT secret configurable. Rate limiting deferred to issue #132 (epic:auth).                                                                                                                                                     |
| A08 | Software & Data Integrity Failures       | ✅ Pass    | `pnpm-lock.yaml` pinned. `--frozen-lockfile` enforced in CI. No unsigned package downloads in CI.                                                                                                                                                                                                                         |
| A09 | Security Logging & Monitoring Failures   | ✅ Pass    | `nestjs-pino` structured logging. Secret fields redacted via `REDACT_PATHS`. Prometheus metrics at `/health/metrics`. OpenTelemetry tracing via `OTEL_EXPORTER_OTLP_ENDPOINT`.                                                                                                                                            |
| A10 | Server-Side Request Forgery (SSRF)       | ✅ Pass    | No user-controlled URL fetching. External calls (OpenAI, Qdrant, Redis, Postgres) are to operator-configured endpoints only.                                                                                                                                                                                              |

## Dependency Audit Triage

Run: `pnpm audit`

### Fixed by `overrides` in `pnpm-workspace.yaml`

| Package   | Severity | CVE/Advisory                             | Action                    |
| --------- | -------- | ---------------------------------------- | ------------------------- |
| multer    | HIGH     | GHSA-c7qv-q95q-8v27                      | Overridden to `>=2.2.0`   |
| form-data | HIGH     | GHSA-hmw2-7cc7-3qxx                      | Overridden to `>=4.0.6`   |
| undici    | HIGH/LOW | GHSA-35p6-xmwp-9g52, GHSA-g8m3-5g58-fq7m | Overridden to `>=6.27.0`  |
| hono      | HIGH/MOD | GHSA-88fw-hqm2-52qc + 4 others           | Overridden to `>=4.12.25` |

### Accepted / Out-of-scope

| Package           | Severity | Path                                    | Reason                                                      |
| ----------------- | -------- | --------------------------------------- | ----------------------------------------------------------- |
| vite              | HIGH     | `packages/client > vitest > vite`       | devDependency only; Windows-path bypass, no server exposure |
| @hono/node-server | MOD      | `@prisma/client > prisma > @prisma/dev` | Prisma's internal dev tooling, not reachable at runtime     |
| PostCSS           | MOD      | build toolchain                         | HTML CSS output — ENGRAM serves no HTML                     |
| launch-editor     | MOD      | dev toolchain                           | Windows NTLMv2, devDependency only                          |
| JS-YAML           | MOD      | build toolchain                         | DoS in merge-key parsing, no user YAML input in production  |

## Security Controls Reference

| Control                     | Implementation                                                             |
| --------------------------- | -------------------------------------------------------------------------- |
| Secret redaction            | `LoggingModule` → `REDACT_PATHS` (`packages/core/src/logging`)             |
| Constant-time token compare | `constantTimeStringEqual` (`apps/mcp-server/src/security/`)                |
| Input validation            | Zod `.strict()` schemas in every MCP tool (`packages/core/src/mcp/tools/`) |
| HTTP security headers       | `helmet()` in `apps/mcp-server/src/main.ts`                                |
| Admin tool guard            | `MCP_ADMIN_TOKEN` check in `MemoryController`                              |
| Dependency pinning          | `pnpm-lock.yaml` + `--frozen-lockfile` in CI                               |
| Metrics / audit trail       | Prometheus at `/health/metrics`; OTel traces optional                      |
