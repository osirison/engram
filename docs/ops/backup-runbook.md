---
title: ENGRAM Backup & Restore Runbook
description: Procedures for backup, restore, and data retention across all ENGRAM stores
---

## Data stores

| Store            | Technology | Persistence                    | Backup method             |
| ---------------- | ---------- | ------------------------------ | ------------------------- |
| Memories         | PostgreSQL | Permanent (LTM + schema)       | `pg_dump --format=custom` |
| Short-term cache | Redis      | Ephemeral with AOF             | `BGSAVE` + RDB copy       |
| Vector index     | Qdrant     | Derived (rebuilt by `reindex`) | Qdrant snapshot API       |

> **Postgres is the source of truth.** Qdrant holds a derived vector index
> that can be rebuilt with `pnpm --filter mcp-server reindex`. If you lose
> only the Qdrant data, restore Postgres and reindex — no Qdrant backup needed.

---

## Quick start

```bash
# Take a full backup
DATABASE_URL=... REDIS_URL=... QDRANT_URL=http://localhost:6333 \
  ./scripts/backup.sh --out /var/backups/engram

# Apply retention policy (keep 30 days daily, 12 weeks weekly)
BACKUP_DIR=/var/backups/engram ./scripts/retention.sh

# Restore from an archive
DATABASE_URL=... REDIS_URL=... QDRANT_URL=http://localhost:6333 \
  ./scripts/restore.sh --archive /var/backups/engram/engram_backup_20260601_020000.tar.gz
```

---

## Retention policy

Configured via env vars or `--flags` to `scripts/retention.sh`:

| Variable                  | Default | Meaning                            |
| ------------------------- | ------- | ---------------------------------- |
| `BACKUP_RETENTION_DAYS`   | `30`    | Daily backups retained for 30 days |
| `BACKUP_RETENTION_WEEKLY` | `12`    | One backup per week for 12 weeks   |

Archives older than 12 weeks are deleted. Set `BACKUP_RETENTION_DAYS=0`
to skip the daily window and go straight to weekly rotation.

### Automating with cron

```cron
# Daily backup at 02:00
0 2 * * * DATABASE_URL=... REDIS_URL=... /opt/engram/scripts/backup.sh --out /var/backups/engram >> /var/log/engram-backup.log 2>&1

# Retention cleanup at 03:00
0 3 * * * BACKUP_DIR=/var/backups/engram /opt/engram/scripts/retention.sh >> /var/log/engram-retention.log 2>&1
```

---

## Restore procedures

### Full restore (all stores)

```bash
./scripts/restore.sh \
  --archive /var/backups/engram/engram_backup_YYYYMMDD_HHMMSS.tar.gz
```

The script will prompt for confirmation before overwriting any data. Pass
`--no-confirm` in unattended environments.

### Postgres only

```bash
./scripts/restore.sh --archive <file> --pg-only
```

### Qdrant only (vector index rebuild is preferred)

```bash
# Option A: restore snapshot
./scripts/restore.sh --archive <file> --qdrant-only

# Option B: rebuild from Postgres (recommended)
MCP_ADMIN_TOKEN=... node dist/reindex.cli.js
```

### Redis only

Redis holds short-term memory TTL state. For most incidents, simply
restarting Redis (or letting STM expire naturally) is acceptable. Restore
the RDB only if preserving in-flight sessions is critical:

```bash
./scripts/restore.sh --archive <file> --redis-only
```

---

## Verify a restore

After restoring Postgres, run the health check and validate memory counts:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready

# Count memories via MCP tool (requires admin token)
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_memories","arguments":{"userId":"<user>"}},"id":1}'
```

---

## Disaster recovery

### Scenario: Postgres lost, Redis + Qdrant intact

1. Provision a new Postgres instance with `pgvector/pgvector:pg17`.
2. Run `pnpm db:migrate:deploy` to apply the schema.
3. **All memory data is lost** — this is a total loss event for LTM.
4. Redis STM keys will expire naturally.
5. Reindex to rebuild Qdrant from the (now empty) Postgres.

Recovery time objective (RTO): < 30 minutes.
Recovery point objective (RPO): time since last successful backup.

### Scenario: Qdrant lost, Postgres intact

1. Stop ingest if needed.
2. Restart Qdrant.
3. Run `pnpm --filter mcp-server reindex` (or use the `reindex_memories` MCP tool).
4. Qdrant is rebuilt from Postgres — no data loss.

---

## Schema for backup archives

Archives are named `engram_backup_YYYYMMDD_HHMMSS.tar.gz` and contain:

```
YYYYMMDD_HHMMSS/
  postgres.pgdump      pg_dump custom-format dump
  redis.rdb            Redis RDB snapshot
  qdrant_memories.snapshot   Qdrant collection snapshot
```

Not all files are present in every archive (depends on which stores are
active for the deployment profile).
