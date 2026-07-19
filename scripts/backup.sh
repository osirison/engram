#!/usr/bin/env bash
# ENGRAM backup script — Postgres
#
# Usage:
#   ./scripts/backup.sh [--compose <compose-file>] [--out <dir>]
#
# Environment variables (override defaults):
#   BACKUP_DIR          destination directory (default: ./backups)
#   DATABASE_URL        postgres connection string
#   COMPOSE_FILE        docker-compose file for exec commands

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

# ── Archive ───────────────────────────────────────────────────────────────────
ARCHIVE="${BACKUP_DIR}/engram_backup_${TIMESTAMP}.tar.gz"
tar -czf "${ARCHIVE}" -C "${BACKUP_DIR}" "${TIMESTAMP}"
rm -rf "${BACKUP_PATH}"
echo "[backup] archive → ${ARCHIVE}"

echo "[backup] complete ✓"
