---
title: ENGRAM Observability
description: Metrics, tracing, and monitoring for the ENGRAM MCP server
---

## Prometheus metrics

Metrics are exposed at `GET /health/metrics` in Prometheus text format.

```bash
curl http://localhost:3000/health/metrics
```

### Application metrics

| Metric                                     | Type      | Labels                  | Description                                                            |
| ------------------------------------------ | --------- | ----------------------- | ---------------------------------------------------------------------- |
| `engram_memory_operations_total`           | counter   | `op`, `tier`, `status`  | Memory operations by type, tier (stm/ltm), and outcome (success/error) |
| `engram_memory_operation_duration_seconds` | histogram | `op`, `tier`            | Operation latency in seconds                                           |
| `engram_memories_promoted_total`           | counter   | —                       | STM memories promoted to LTM by the consolidation scheduler            |
| `engram_consolidation_runs_total`          | counter   | `status`                | Consolidation scheduler runs (success/partial)                         |
| `engram_reindex_operations_total`          | counter   | `status`                | Vector-store reindex operations                                        |
| `engram_active_mcp_sessions`               | gauge     | —                       | Active Streamable HTTP MCP sessions                                    |
| `engram_vector_backend_info`               | gauge     | `backend`               | Active vector backend (qdrant/pgvector)                                |
| `engram_deployment_profile_info`           | gauge     | `profile`               | Active deployment profile                                              |
| `engram_pgvector_ready`                    | gauge     | —                       | Whether pgvector extension is reachable                                |
| `engram_embeddings_cache_hits_total`       | counter   | —                       | Embedding cache hits (from EmbeddingsService)                          |
| `engram_embeddings_cache_misses_total`     | counter   | —                       | Embedding cache misses                                                 |
| `engram_agent_memory_operations_total`     | counter   | `agent`, `op`, `status` | Store/recall ops per agent (API key) — primary-memory adoption (WP5)   |

Standard Node.js process metrics (`process_cpu_seconds_total`, `nodejs_heap_size_bytes`, etc.) are also exposed automatically by `prom-client`.

### Per-agent memory usage

`engram_agent_memory_operations_total` shows whether each agent actually uses
ENGRAM as primary memory. The `agent` label is the authenticated API-key id (or
`local` for unauthenticated/stdio calls); `op` is `store` or `recall`.

Store/recall rate per agent:

```promql
sum by (agent, op) (rate(engram_agent_memory_operations_total[5m]))
```

Daily adoption (an agent with no series has never used ENGRAM):

```promql
sum by (agent) (increase(engram_agent_memory_operations_total[1d]))
```

### Prometheus scrape config

```yaml
# prometheus.yml
scrape_configs:
  - job_name: engram-mcp-server
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /health/metrics
    scrape_interval: 15s
```

---

## OpenTelemetry tracing

Distributed tracing is **disabled by default** and activates when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=engram-mcp-server        # default
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

Traces are exported over OTLP HTTP to `<endpoint>/v1/traces`.

### Instrumented paths

HTTP requests and Express routes are auto-instrumented. Memory
operations (`create`, `recall`, `reindex`) emit spans via the
`@opentelemetry/api` integration.

### Compatible backends

Any OTLP-compatible collector:

- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)
- Jaeger (via OTLP receiver)
- Grafana Tempo
- Honeycomb, Datadog, Lightstep (OTLP endpoint)

### Local tracing with Jaeger

```bash
# Start Jaeger with OTLP support
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Start ENGRAM with tracing
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  pnpm --filter mcp-server dev
```

Open [http://localhost:16686](http://localhost:16686) to explore traces.

---

## Health endpoints

| Endpoint              | Purpose                                   |
| --------------------- | ----------------------------------------- |
| `GET /health`         | Liveness probe                            |
| `GET /health/ready`   | Readiness probe (checks all dependencies) |
| `GET /health/metrics` | Prometheus metrics                        |

See `docs/deploy.md` for Kubernetes/Docker probe configuration.
