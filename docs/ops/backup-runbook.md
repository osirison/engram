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

Both scripts locate the Redis RDB automatically. Precedence:

1. `REDIS_CONTAINER=<id|name>` — copy through `docker exec` / `docker
stop|cp|start` on that container. Use this for bare `docker run`
   deployments and CI service containers (no compose project).
2. A running `redis` service in `COMPOSE_FILE` (default
   `docker-compose.prod.yml`).
3. Bare-metal `/var/lib/redis/dump.rdb` (backup only).

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

# Offsite sync at 02:30 (after the backup, before local pruning)
30 2 * * * rclone sync /var/backups/engram remote:engram-backups --include "engram_backup_*.tar.gz" >> /var/log/engram-offsite.log 2>&1

# Retention cleanup at 03:00
0 3 * * * BACKUP_DIR=/var/backups/engram /opt/engram/scripts/retention.sh >> /var/log/engram-retention.log 2>&1
```

Order matters: sync offsite **before** `retention.sh` prunes locally, so an
archive is never deleted from the only copy that has it.

---

## Offsite replication (3-2-1)

`backup.sh` writes to local disk only. A disk or host loss therefore takes
the backups down with the data unless archives are replicated offsite. Aim
for 3-2-1: three copies, two media, one offsite.

Sync the archive directory to object storage after every backup run, e.g.:

```bash
# rclone (any S3/GCS/B2/Azure remote)
rclone sync /var/backups/engram remote:engram-backups \
  --include "engram_backup_*.tar.gz"

# or the AWS CLI
aws s3 sync /var/backups/engram s3://<bucket>/engram-backups \
  --exclude '*' --include 'engram_backup_*.tar.gz'
```

Recommendations:

- **Retention at the destination** — apply lifecycle rules on the bucket (or
  run `retention.sh` against a synced mirror); `rclone sync` propagates local
  deletions, so a bucket with versioning/lifecycle is the safety net.
- **Encrypt before upload** when the bucket is not already encrypted with a
  customer-managed key: `age -r <recipient> -o <archive>.age <archive>`
  (or `gpg --encrypt`). Postgres dumps contain user memory content.
- **Restrict credentials** — the sync job only needs write/list on the
  backup prefix; use a scoped key, never the deployment's admin credentials.
- **Verify restorability, not just existence** — the nightly
  [backup verification workflow](#continuous-verification-in-ci) proves the
  scripts round-trip; periodically restore an offsite archive into a
  scratch environment to prove the offsite copies do too.

---

## Continuous verification in CI

Two layers of automated coverage:

- **Every PR / push** — `backup-restore.spec.ts` (mcp-server suite) checks
  the Postgres leg: `backup.sh` produces an archive and `restore.sh
--pg-only` round-trips data. Beyond a legacy sentinel table, it now seeds
  and asserts the WP2-4 tables — `memory_links`, `memory_audits`, and
  `memory_import_sources` — so a dump that silently drops them (e.g. a future
  `--table` allowlist) reddens the PR (G9). `retention.sh` pruning is covered
  by `backup-scripts.spec.ts` against fake aged archives.
- **Nightly** — [`backup-verify.yml`](../../.github/workflows/backup-verify.yml)
  (cron + manual `workflow_dispatch`) runs the full `backup.sh` →
  `restore.sh` path against throwaway Postgres, Redis, and Qdrant service
  containers: provisions the real ENGRAM schema, seeds all three stores
  (including the same WP2-4 tables), backs up, destroys the live data,
  restores, asserts every sentinel round-trips, and exercises the
  `retention.sh` GFS policy. A red run means the restore path is broken —
  treat it like a production incident, not a flaky test.

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
