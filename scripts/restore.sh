#!/usr/bin/env bash
# ENGRAM restore script — Postgres
#
# Usage:
#   ./scripts/restore.sh --archive <engram_backup_YYYYMMDD_HHMMSS.tar.gz> [options]
#
# Options:
#   --archive <file>     backup archive produced by backup.sh (required)
#   --compose <file>     docker-compose file (default: docker-compose.prod.yml)
#   --no-confirm         skip interactive confirmation prompt
#
# Environment:
#   DATABASE_URL         postgres connection string (postgres restore)

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ARCHIVE=""
NO_CONFIRM=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)     ARCHIVE="$2"; shift 2 ;;
    --compose)     COMPOSE_FILE="$2"; shift 2 ;;
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

echo "[restore] complete ✓"
