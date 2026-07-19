#!/usr/bin/env bash
# ENGRAM backup script — Postgres, Redis
#
# Usage:
#   ./scripts/backup.sh [--compose <compose-file>] [--out <dir>]
#
# Environment variables (override defaults):
#   BACKUP_DIR          destination directory (default: ./backups)
#   DATABASE_URL        postgres connection string
#   REDIS_URL           redis connection string
#   COMPOSE_FILE        docker-compose file for exec commands
#   REDIS_CONTAINER     docker container id/name running redis; when set the
#                       RDB is copied with `docker exec` instead of compose
#                       (used by CI service containers and bare `docker run`)

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-./backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
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
  # Pass the password via REDISCLI_AUTH (env) rather than -a so the secret
  # never appears in the process list / argv.
  if [[ "${REDIS_PASS}" != "${REDIS_URL}" && -n "${REDIS_PASS}" ]]; then
    export REDISCLI_AUTH="${REDIS_PASS}"
  fi

  redis-cli "${REDIS_CLI_ARGS[@]}" BGSAVE
  # Wait for the background save to finish, then confirm it succeeded. INFO
  # persistence is authoritative (LASTSAVE polling raced when the save
  # completed within one second).
  BGSAVE_INFO=""
  for _ in {1..30}; do
    BGSAVE_INFO="$(redis-cli "${REDIS_CLI_ARGS[@]}" INFO persistence)"
    if grep -q 'rdb_bgsave_in_progress:0' <<<"${BGSAVE_INFO}"; then
      break
    fi
    BGSAVE_INFO=""
    sleep 1
  done
  # Never copy a stale/partial RDB: abort if the save did not finish in time,
  # or finished but reported a failure.
  if [[ -z "${BGSAVE_INFO}" ]]; then
    echo "[backup] error: redis BGSAVE did not complete within 30s — aborting" >&2
    exit 1
  fi
  if ! grep -q 'rdb_last_bgsave_status:ok' <<<"${BGSAVE_INFO}"; then
    echo "[backup] error: redis BGSAVE reported failure (rdb_last_bgsave_status) — aborting" >&2
    exit 1
  fi

  # Copy RDB file out of the container (or locally if running bare-metal).
  # Precedence: explicit REDIS_CONTAINER → running compose service → local FS.
  if [[ -n "${REDIS_CONTAINER:-}" ]]; then
    docker exec "${REDIS_CONTAINER}" cat /data/dump.rdb \
      > "${BACKUP_PATH}/redis.rdb"
  elif [[ -n "$(docker compose -f "${COMPOSE_FILE}" ps -q redis 2>/dev/null)" ]]; then
    # `ps -q` prints a container id only when the service is actually running
    # (`ps <service>` exits 0 even when nothing is up, so its exit code is not
    # a reliable signal).
    docker compose -f "${COMPOSE_FILE}" exec -T redis \
      cat /data/dump.rdb > "${BACKUP_PATH}/redis.rdb"
  elif [[ -f /var/lib/redis/dump.rdb ]]; then
    cp /var/lib/redis/dump.rdb "${BACKUP_PATH}/redis.rdb"
  else
    echo "[backup] warning: could not locate redis RDB file — skipping copy"
  fi
  # Only report success when the RDB was actually captured.
  if [[ -s "${BACKUP_PATH}/redis.rdb" ]]; then
    echo "[backup] redis done → ${BACKUP_PATH}/redis.rdb"
  fi
else
  echo "[backup] REDIS_URL not set — skipping redis"
fi

# ── Archive ───────────────────────────────────────────────────────────────────
ARCHIVE="${BACKUP_DIR}/engram_backup_${TIMESTAMP}.tar.gz"
tar -czf "${ARCHIVE}" -C "${BACKUP_DIR}" "${TIMESTAMP}"
rm -rf "${BACKUP_PATH}"
echo "[backup] archive → ${ARCHIVE}"

echo "[backup] complete ✓"
