#!/usr/bin/env bash
# ENGRAM backup script — Postgres, Redis, Qdrant
#
# Usage:
#   ./scripts/backup.sh [--compose <compose-file>] [--out <dir>]
#
# Environment variables (override defaults):
#   BACKUP_DIR          destination directory (default: ./backups)
#   DATABASE_URL        postgres connection string
#   REDIS_URL           redis connection string
#   QDRANT_URL          qdrant HTTP URL (default: http://localhost:6333)
#   COMPOSE_FILE        docker-compose file for exec commands

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-./backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

# ── Arg parse ─────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose) COMPOSE_FILE="$2"; shift 2 ;;
    --out)     BACKUP_DIR="$2"; BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "${BACKUP_PATH}"
echo "[backup] starting — writing to ${BACKUP_PATH}"

# ── Postgres ──────────────────────────────────────────────────────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[backup] dumping postgres …"
  PG_DUMP=(pg_dump)
  if ! command -v pg_dump &>/dev/null; then
    # Fall back to docker exec if pg_dump is not available locally.
    # Use an array so a COMPOSE_FILE path with spaces is not word-split.
    PG_DUMP=(docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_dump)
  fi
  "${PG_DUMP[@]}" "${DATABASE_URL}" \
    --format=custom \
    --no-acl \
    --no-owner \
    > "${BACKUP_PATH}/postgres.pgdump"
  echo "[backup] postgres done → ${BACKUP_PATH}/postgres.pgdump"
else
  echo "[backup] DATABASE_URL not set — skipping postgres"
fi

# ── Redis ─────────────────────────────────────────────────────────────────────
if [[ -n "${REDIS_URL:-}" ]]; then
  echo "[backup] triggering redis BGSAVE …"
  # Parse host/port from REDIS_URL (redis[s]://[:password@]host[:port][/db])
  REDIS_HOST="$(echo "${REDIS_URL}" | sed -E 's|redis[s]?://([^:@]*:?[^@]*@)?([^:/]+)(:[0-9]+)?.*|\2|')"
  REDIS_PORT="$(echo "${REDIS_URL}" | sed -E 's|redis[s]?://([^:@]*:?[^@]*@)?[^:/]+(:[0-9]+)?.*|\2|' | tr -d ':')"
  REDIS_PORT="${REDIS_PORT:-6379}"
  REDIS_PASS="$(echo "${REDIS_URL}" | sed -E 's|redis[s]?://[^:]*:([^@]+)@.*|\1|')"

  REDIS_CLI_ARGS=(-h "${REDIS_HOST}" -p "${REDIS_PORT}")
  if [[ "${REDIS_PASS}" != "${REDIS_URL}" && -n "${REDIS_PASS}" ]]; then
    REDIS_CLI_ARGS+=(-a "${REDIS_PASS}")
  fi

  redis-cli "${REDIS_CLI_ARGS[@]}" BGSAVE
  # Wait for BGSAVE to complete (polls LASTSAVE).
  LAST_SAVE="$(redis-cli "${REDIS_CLI_ARGS[@]}" LASTSAVE)"
  for _ in {1..30}; do
    sleep 1
    NEW_SAVE="$(redis-cli "${REDIS_CLI_ARGS[@]}" LASTSAVE)"
    if [[ "${NEW_SAVE}" -gt "${LAST_SAVE}" ]]; then break; fi
  done

  # Copy RDB file out of the container (or locally if running bare-metal).
  if docker compose -f "${COMPOSE_FILE}" ps redis &>/dev/null 2>&1; then
    docker compose -f "${COMPOSE_FILE}" exec -T redis \
      cat /data/dump.rdb > "${BACKUP_PATH}/redis.rdb"
  elif [[ -f /var/lib/redis/dump.rdb ]]; then
    cp /var/lib/redis/dump.rdb "${BACKUP_PATH}/redis.rdb"
  else
    echo "[backup] warning: could not locate redis RDB file — skipping copy"
  fi
  echo "[backup] redis done → ${BACKUP_PATH}/redis.rdb"
else
  echo "[backup] REDIS_URL not set — skipping redis"
fi

# ── Qdrant ────────────────────────────────────────────────────────────────────
echo "[backup] creating qdrant snapshot …"
COLLECTION="${VECTOR_COLLECTION:-memories}"
SNAPSHOT_RESP="$(curl -sf -X POST "${QDRANT_URL}/collections/${COLLECTION}/snapshots" \
  -H 'Content-Type: application/json' || echo '{}')"
# grep -oE (POSIX) instead of grep -oP (PCRE \K) so this works on BusyBox/BSD
# grep too; preserve empty-on-no-match so the guard below skips correctly.
SNAPSHOT_NAME="$(echo "${SNAPSHOT_RESP}" | grep -oE '"name":"[^"]+"' | head -1 | cut -d'"' -f4 || true)"

if [[ -n "${SNAPSHOT_NAME}" ]]; then
  curl -sf "${QDRANT_URL}/collections/${COLLECTION}/snapshots/${SNAPSHOT_NAME}" \
    -o "${BACKUP_PATH}/qdrant_${COLLECTION}.snapshot"
  echo "[backup] qdrant done → ${BACKUP_PATH}/qdrant_${COLLECTION}.snapshot"
else
  echo "[backup] warning: qdrant snapshot creation failed or returned unexpected response"
fi

# ── Archive ───────────────────────────────────────────────────────────────────
ARCHIVE="${BACKUP_DIR}/engram_backup_${TIMESTAMP}.tar.gz"
tar -czf "${ARCHIVE}" -C "${BACKUP_DIR}" "${TIMESTAMP}"
rm -rf "${BACKUP_PATH}"
echo "[backup] archive → ${ARCHIVE}"

echo "[backup] complete ✓"
