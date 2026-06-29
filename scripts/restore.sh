#!/usr/bin/env bash
# ENGRAM restore script — Postgres, Redis, Qdrant
#
# Usage:
#   ./scripts/restore.sh --archive <engram_backup_YYYYMMDD_HHMMSS.tar.gz> [options]
#
# Options:
#   --archive <file>     backup archive produced by backup.sh (required)
#   --compose <file>     docker-compose file (default: docker-compose.prod.yml)
#   --pg-only            restore only postgres
#   --redis-only         restore only redis
#   --qdrant-only        restore only qdrant
#   --no-confirm         skip interactive confirmation prompt

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ARCHIVE=""
PG_ONLY=false
REDIS_ONLY=false
QDRANT_ONLY=false
NO_CONFIRM=false
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)     ARCHIVE="$2"; shift 2 ;;
    --compose)     COMPOSE_FILE="$2"; shift 2 ;;
    --pg-only)     PG_ONLY=true; shift ;;
    --redis-only)  REDIS_ONLY=true; shift ;;
    --qdrant-only) QDRANT_ONLY=true; shift ;;
    --no-confirm)  NO_CONFIRM=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${ARCHIVE}" ]]; then
  echo "Error: --archive is required" >&2
  exit 1
fi

if [[ ! -f "${ARCHIVE}" ]]; then
  echo "Error: archive not found: ${ARCHIVE}" >&2
  exit 1
fi

if [[ "${NO_CONFIRM}" != "true" ]]; then
  echo "WARNING: This will overwrite current data. Continue? [y/N]"
  read -r CONFIRM
  if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

echo "[restore] extracting ${ARCHIVE} …"
tar -xzf "${ARCHIVE}" -C "${WORK_DIR}"
BACKUP_DIR="$(find "${WORK_DIR}" -mindepth 1 -maxdepth 1 -type d | head -1)"

# ── Postgres ──────────────────────────────────────────────────────────────────
if [[ "${REDIS_ONLY}" != "true" && "${QDRANT_ONLY}" != "true" ]]; then
  PGDUMP="${BACKUP_DIR}/postgres.pgdump"
  if [[ -f "${PGDUMP}" ]]; then
    echo "[restore] restoring postgres …"
    if [[ -n "${DATABASE_URL:-}" ]]; then
      # Drop and recreate the public schema so existing objects are removed.
      psql "${DATABASE_URL}" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
      pg_restore -d "${DATABASE_URL}" \
        --no-acl \
        --no-owner \
        --single-transaction \
        "${PGDUMP}"
      echo "[restore] postgres done ✓"
    else
      echo "[restore] DATABASE_URL not set — skipping postgres"
    fi
  else
    echo "[restore] no postgres dump found in archive"
  fi
fi

# ── Redis ─────────────────────────────────────────────────────────────────────
if [[ "${PG_ONLY}" != "true" && "${QDRANT_ONLY}" != "true" ]]; then
  RDB="${BACKUP_DIR}/redis.rdb"
  if [[ -f "${RDB}" ]]; then
    echo "[restore] restoring redis …"
    if docker compose -f "${COMPOSE_FILE}" ps redis &>/dev/null 2>&1; then
      docker compose -f "${COMPOSE_FILE}" stop redis
      docker compose -f "${COMPOSE_FILE}" cp "${RDB}" redis:/data/dump.rdb
      docker compose -f "${COMPOSE_FILE}" start redis
      echo "[restore] redis done ✓"
    else
      echo "[restore] docker-compose redis service not running — copy ${RDB} manually"
    fi
  else
    echo "[restore] no redis RDB found in archive"
  fi
fi

# ── Qdrant ────────────────────────────────────────────────────────────────────
if [[ "${PG_ONLY}" != "true" && "${REDIS_ONLY}" != "true" ]]; then
  COLLECTION="${VECTOR_COLLECTION:-memories}"
  SNAPSHOT="$(find "${BACKUP_DIR}" -name "qdrant_*.snapshot" | head -1)"
  if [[ -n "${SNAPSHOT}" && -f "${SNAPSHOT}" ]]; then
    echo "[restore] restoring qdrant …"
    UPLOAD_RESP="$(curl -sf -X POST \
      "${QDRANT_URL}/collections/${COLLECTION}/snapshots/upload" \
      -H 'Content-Type: application/octet-stream' \
      --data-binary "@${SNAPSHOT}" || echo '{}')"
    echo "[restore] qdrant response: ${UPLOAD_RESP}"
    echo "[restore] qdrant done ✓"
  else
    echo "[restore] no qdrant snapshot found in archive"
  fi
fi

echo "[restore] complete ✓"
