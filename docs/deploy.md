---
title: ENGRAM Production Deployment Guide
description: How to build and run the hardened production Docker image
---

## Overview

The production image is a multi-stage, non-root Alpine build. The three
supported deployment paths are:

| Path           | File                         | Use it for          |
| -------------- | ---------------------------- | ------------------- |
| Docker Compose | `docker-compose.prod.yml`    | Single-host / VPS   |
| Kubernetes     | `docs/k8s/` (coming soon)    | Cluster deployments |
| Manual         | `apps/mcp-server/Dockerfile` | Custom infra        |

---

## Prerequisites

- Docker 25+ with BuildKit (`DOCKER_BUILDKIT=1`)
- Docker Compose v2.24+
- A `.env.prod` file based on `.env.example`

---

## Building the Image

```bash
# From the repository root
docker build \
  --file apps/mcp-server/Dockerfile \
  --tag engram-mcp-server:latest \
  .
```

The multi-stage build:

1. **deps** — installs all workspace deps from the locked lockfile.
2. **builder** — compiles TypeScript (`nest build`) and runs `pnpm deploy` to
   produce a flat production bundle at `/prod`.
3. **production** — copies only the pruned bundle; runs as a non-root
   `engram` user.

### Image properties

| Property        | Value                        |
| --------------- | ---------------------------- |
| Base            | `node:22-alpine`             |
| User            | `engram` (non-root UID 1000) |
| Port            | `3000`                       |
| Default profile | `enterprise`                 |
| Entrypoint      | `node dist/main.js`          |

---

## Single-host deployment (Docker Compose)

### 1. Create the env file

```bash
cp .env.example .env.prod
# Edit .env.prod and set at minimum:
#   POSTGRES_PASSWORD, REDIS_PASSWORD, MCP_ADMIN_TOKEN, OPENAI_API_KEY
```

### 2. Run database migrations

```bash
docker compose -f docker-compose.prod.yml run --rm mcp-server \
  sh -c 'node_modules/.bin/prisma migrate deploy'
```

### 3. Start all services

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 4. Verify health

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
curl http://localhost:3000/health/metrics
```

---

## Profile selection

Set `DEPLOYMENT_PROFILE` in `.env.prod`:

| Value        | External services                   |
| ------------ | ----------------------------------- |
| `memory`     | None (dev/demo only)                |
| `lite`       | Postgres only                       |
| `enterprise` | Postgres + Redis + Qdrant (default) |

---

## Observability

### Prometheus metrics

`GET /health/metrics` returns Prometheus text format. Scrape it with a
Prometheus job:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: engram
    static_configs:
      - targets: ['engram-mcp-server:3000']
    metrics_path: /health/metrics
```

Key metrics:

| Metric                                     | Type      | Labels                 |
| ------------------------------------------ | --------- | ---------------------- |
| `engram_memory_operations_total`           | counter   | `op`, `tier`, `status` |
| `engram_memory_operation_duration_seconds` | histogram | `op`, `tier`           |
| `engram_memories_promoted_total`           | counter   | —                      |
| `engram_consolidation_runs_total`          | counter   | `status`               |
| `engram_reindex_operations_total`          | counter   | `status`               |
| `engram_active_mcp_sessions`               | gauge     | —                      |
| `engram_vector_backend_info`               | gauge     | `backend`              |
| `engram_deployment_profile_info`           | gauge     | `profile`              |

### OpenTelemetry tracing

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to enable distributed tracing. When
unset the SDK is never loaded and there is zero overhead:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=engram-mcp-server
```

HTTP and Express spans are emitted automatically. Memory operation spans
can be added via `@opentelemetry/api` in service code.

---

## Image in CI

The `docker-build` job in `.github/workflows/ci.yml` builds the image on
every push to `main` and on pull requests. The image is not pushed unless
`REGISTRY_TOKEN` is set in repository secrets.

---

## Updating

```bash
# Pull latest image or rebuild
docker compose -f docker-compose.prod.yml pull mcp-server
docker compose -f docker-compose.prod.yml up -d mcp-server

# After schema changes
docker compose -f docker-compose.prod.yml run --rm mcp-server \
  node_modules/.bin/prisma migrate deploy
```

---

## Security considerations

- All secrets are passed via environment variables; never baked into the image.
- The container runs as user `engram` (non-root); the image has no shell.
- Postgres and Redis ports are not published externally in `docker-compose.prod.yml`.
- Review `docs/security/owasp-checklist.md` before going to production.
