---
title: Local Persistence Threat Model Research
description: Threat model and security controls for an accessible profile-lite local persistence mode in ENGRAM
author: GitHub Copilot
ms.date: 2026-06-02
ms.topic: reference
---

## Research scope

- Produce practical threat model for profile-lite local persistence
- Identify default controls for file permissions, encryption options, secret handling, tenancy boundaries, and logging
- Map controls to current architecture and likely file changes
- Evaluate strict-by-default versus optional-hardening posture
- Recommend a balanced posture with implementation checklist and evidence

## Status

Complete.

## Assets

- Memory payloads and metadata:
  - Long-term content, metadata, tags, embeddings in Postgres schema: prisma/schema.prisma:26-50
  - Short-term memory objects serialized in Redis values: packages/memory-stm/src/memory-stm.service.ts:63-81
- Tenant identifiers and boundaries:
  - Mandatory userId on memory records: prisma/schema.prisma:28,47-48
  - Vector payload requires userId for isolation: packages/vector-store/src/vector-store.interface.ts:31-53
- Administrative control plane:
  - Reindex admin token comparison path: apps/mcp-server/src/memory/memory.controller.ts:62-69
- Secrets and runtime config:
  - Environment secret examples and defaults: .env.example:16-55
  - Compose default admin token fallback: docker-compose.yml:79
- Service endpoints and exposed surfaces:
  - Streamable HTTP MCP endpoint registration at /mcp: apps/mcp-server/src/main.ts:63-77
  - Exposed host ports for DB/Redis/Qdrant/MCP/Inspector: docker-compose.yml:9-10,27-28,43-45,81-82,114-116

## Threat actors

- Local user on same machine:
  - Reads local persistence files, env files, or shell history
  - Scrapes process memory or local logs
- Malicious local process (same user context):
  - Reads world-readable files if profile-lite writes weak permissions
  - Tries token replay against local MCP endpoint
- Remote actor with network path to host-exposed ports:
  - Hits streamable /mcp endpoint when transport is HTTP
  - Exploits weak/default admin token if reachable
- Cross-tenant abusive client:
  - Supplies another tenant userId in tool inputs
  - Attempts broad list/search enumeration

## Abuse cases

- Token abuse via weak operational defaults:
  - docker-compose.yml defines MCP_ADMIN_TOKEN default value dev-inspector-admin-token (docker-compose.yml:79)
  - If operator forgets override, maintenance operations become guessable in local/shared environments
- Unauthorized maintenance operation attempts:
  - Maintenance auth uses direct string comparison and throws on mismatch (apps/mcp-server/src/memory/memory.controller.ts:62-69)
  - No rate limiting or lockout evidence in this path
- Tenancy spoofing at API layer:
  - Tool handlers accept userId from request payload and route directly (apps/mcp-server/src/memory/memory.controller.ts:87-94,125-131)
  - No user identity binding or auth principal validation shown in /mcp path (apps/mcp-server/src/main.ts:71-77)
- Data disclosure through logs:
  - Memory service logs request options object, which can include search text/tags (apps/mcp-server/src/memory/memory.service.ts:218-221)
  - Logging module has serializers for req/res metadata but no explicit secret redaction list (packages/core/src/logging/logging.module.ts:22-31)
- Persistence confidentiality risk in profile-lite (future mode):
  - Current architecture has no encrypted local-at-rest mechanism for memory persistence
  - Local profile introduced without file permission and crypto controls would expose memory contents to local compromise
- Service reachability broadens attack surface:
  - Compose maps infra services to host ports by default (docker-compose.yml:9-10,27-28,43-45)

## Controls needed by default for profile-lite

### File permissions

- Persist data directory with owner-only permissions:
  - Directory mode 0700
  - Data files mode 0600
  - Atomic writes via temp file then rename to avoid partial-write corruption
- Enforce startup permission checks:
  - Refuse startup if file mode is too permissive
  - Emit precise remediation message

### Encryption options

- Default at-rest encryption for persisted memory payloads
- Support two keying modes:
  - Accessible mode: passphrase supplied via env or prompt for local/dev setup
  - Enterprise mode: OS keychain or external KMS plugin
- Cryptographic baseline:
  - AEAD (for example AES-256-GCM or XChaCha20-Poly1305)
  - Per-record or per-file nonce strategy with authenticated metadata
  - Key rotation support with versioned key identifiers
- Explicit break-glass option:
  - Plaintext persistence only with explicit insecure flag and startup warning

### Secret handling

- Remove weak defaults and enforce secret quality:
  - No default MCP_ADMIN_TOKEN value in compose for non-test profiles
  - Minimum length and entropy checks at config validation time
- Avoid logging raw token values and auth headers
- Distinguish test/dev tokens from production tokens at startup

### Tenancy boundaries

- Bind tool-level userId to authenticated principal instead of trusting caller-provided userId
- Preserve and extend existing storage-level tenant scoping:
  - Vector search userId required in both backends (packages/vector-store/src/qdrant.vector-store.ts:96-99 and packages/vector-store/src/pgvector.vector-store.ts:198-214)
  - LTM queries constrained by userId (packages/memory-ltm/src/memory-ltm.service.ts:123-129,559-563)
  - STM key namespaced by userId (packages/memory-stm/src/types.ts:138-147)

### Logging

- Add structured redaction policy for sensitive fields:
  - adminToken, authorization, apiKey, OPENAI_API_KEY, metadata secrets
- Restrict debug-level payload logging in production
- Keep audit logs for maintenance operations with minimal sensitive context

## Control mapping to current architecture and likely file changes

- Config and profile gating:
  - Update packages/config/src/env.schema.ts:7-31
  - Add PROFILE mode and profile-lite settings such as LOCAL_DATA_DIR, LOCAL_ENCRYPTION_MODE, LOCAL_KEY_SOURCE
  - Add MCP_ADMIN_TOKEN validation in schema rather than ad-hoc reads
- Conditional module composition for profile-lite:
  - Refactor apps/mcp-server/src/app.module.ts:17-31 to profile-driven imports
  - Skip PrismaModule, RedisModule, QdrantModule when profile-lite local backend is selected
- Local persistence backend package:
  - Add a new package, likely packages/memory-local, implementing memory interfaces used by apps/mcp-server/src/memory/memory.service.ts:142-180
  - Prefer well-maintained storage/crypto libraries instead of bespoke crypto code
- Auth and tenancy binding for MCP transport:
  - Add auth middleware/guard in apps/mcp-server/src/main.ts:70-77 for /mcp requests
  - Refactor apps/mcp-server/src/memory/memory.controller.ts to derive tenant from auth context, not raw tool input
- Hardening maintenance auth:
  - Replace direct token compare in apps/mcp-server/src/memory/memory.controller.ts:62-69 with constant-time comparison and audit events
- Logging redaction:
  - Extend packages/core/src/logging/logging.module.ts:6-33 with redact configuration
  - Reduce broad debug object logging in apps/mcp-server/src/memory/memory.service.ts:218-221
- Operational defaults:
  - Remove compose fallback token in docker-compose.yml:79
  - Keep admin token documented but required in .env.example:51-52

## Alternatives

### Option A: Strict-by-default

- Characteristics:
  - Encrypted local persistence enabled by default
  - Owner-only file permissions enforced at startup
  - No weak default admin tokens
  - Authenticated principal required for tenant-scoped operations
  - Redacted logging baseline on by default
- Security posture:
  - Closest to enterprise baseline
  - Reduced chance of accidental insecure deployment
- Accessibility impact:
  - Slightly higher setup friction
  - Requires key bootstrap and clearer onboarding

### Option B: Optional-hardening

- Characteristics:
  - Plaintext local persistence default for easiest onboarding
  - Encryption and strict permissions opt-in
  - Minimal auth assumptions for local-only usage
- Security posture:
  - Faster first-run experience
  - Higher risk of accidental insecure operation persisting into shared/dev environments
- Accessibility impact:
  - Lowest friction initially
  - Higher migration burden later

## Recommendation

Adopt Option A with guided accessibility rails.

Rationale:

- Current code already targets strong tenant isolation in storage/query layers, so default-secure profile-lite aligns with existing design intent:
  - Tenant-mandatory vector filters in both backends (packages/vector-store/src/qdrant.vector-store.ts:96-99 and packages/vector-store/src/pgvector.vector-store.ts:198-214)
  - User-scoped memory data model and query filtering (prisma/schema.prisma:28,47-48 and packages/memory-ltm/src/memory-ltm.service.ts:123-129,559-563)
- Current operational defaults still contain accessibility-first but insecure shortcuts:
  - Compose fallback maintenance token (docker-compose.yml:79)
  - Host-exposed infrastructure ports by default (docker-compose.yml:9-10,27-28,43-45)
- A strict baseline with explicit break-glass gives accessibility without silently weakening posture.

Balanced implementation pattern:

- Default secure path: encryption on, strict permissions on, redaction on, no default admin token
- Explicit local-dev override path: insecure mode requires explicit flag plus loud startup warning and non-production guard

## Implementation checklist

- Add profile-lite env contract and validation in packages/config/src/env.schema.ts
- Introduce profile-aware module wiring in apps/mcp-server/src/app.module.ts
- Implement local persistence adapter with enforced 0700/0600 permissions
- Implement encrypted-at-rest storage format with key versioning and rotation hooks
- Add /mcp auth middleware and bind tenant from auth principal
- Replace direct token equality check with constant-time comparison and add maintenance audit logging
- Add pino redaction rules and reduce verbose debug payload logging for user inputs
- Remove insecure compose fallback admin token and require explicit token provisioning
- Add tests for:
  - Permission enforcement failure paths
  - Encryption key missing/invalid behavior
  - Tenant spoof attempts at tool layer
  - Log redaction for secrets and token fields
- Update setup docs with profile-lite secure bootstrap and break-glass procedure

## Key evidence summary

- Mandatory external URLs in current env schema: packages/config/src/env.schema.ts:10-12
- Enterprise-first module imports today: apps/mcp-server/src/app.module.ts:27-31
- Eager DB connect on module init: packages/database/src/prisma.service.ts:28-29
- Redis immediate connection: packages/redis/src/redis.module.ts:18
- MCP HTTP endpoint receives requests without visible auth enforcement in this file: apps/mcp-server/src/main.ts:71-77
- Maintenance token logic exists but is raw equality check: apps/mcp-server/src/memory/memory.controller.ts:62-69
- Admin token length validation only in reindex DTO input schema: apps/mcp-server/src/memory/dto/reindex.dto.ts:11-13
- Logging module has serializers but no explicit redaction config: packages/core/src/logging/logging.module.ts:22-31
- Memory service logs option objects including search/tags context: apps/mcp-server/src/memory/memory.service.ts:218-221
- Compose currently includes dev fallback admin token: docker-compose.yml:79

## Clarifying questions

- Should profile-lite permit plaintext persistence only in NODE_ENV=development, or never by policy?
- Is per-tenant auth for MCP tools expected in v0.3 scope, or should profile-lite ship with single-tenant local-only assumption plus explicit warning?
- Do you want encryption keys sourced from OS keychain first, env second, or the reverse for CI/dev ergonomics?
