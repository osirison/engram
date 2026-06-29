#!/usr/bin/env bash
# ENGRAM backup retention cleanup
#
# Applies a GFS (Grandfather-Father-Son) retention policy:
#   - keep all backups from the last N days (daily)
#   - keep one backup per week for the last W weeks
#   - delete everything older
#
# Usage:
#   ./scripts/retention.sh [--dir <backup-dir>] [--days <N>] [--weeks <W>]
#
# Environment:
#   BACKUP_DIR                backup directory (default: ./backups)
#   BACKUP_RETENTION_DAYS     daily retention (default: 30)
#   BACKUP_RETENTION_WEEKLY   weekly retention in weeks (default: 12)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${BACKUP_RETENTION_DAYS:-30}"
RETAIN_WEEKS="${BACKUP_RETENTION_WEEKLY:-12}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)   BACKUP_DIR="$2"; shift 2 ;;
    --days)  RETAIN_DAYS="$2"; shift 2 ;;
    --weeks) RETAIN_WEEKS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

echo "[retention] scanning ${BACKUP_DIR} (keep ${RETAIN_DAYS}d daily, ${RETAIN_WEEKS}w weekly)"

NOW="$(date +%s)"
DAILY_CUTOFF=$(( NOW - RETAIN_DAYS * 86400 ))
WEEKLY_CUTOFF=$(( NOW - RETAIN_WEEKS * 7 * 86400 ))

declare -A KEEP_WEEKS

# Determine which weekly anchors (one per week) to keep.
for i in $(seq 0 "${RETAIN_WEEKS}"); do
  WEEK_TS=$(( NOW - i * 7 * 86400 ))
  WEEK_KEY="$(date -d "@${WEEK_TS}" +%Y_W%V 2>/dev/null || date -r "${WEEK_TS}" +%Y_W%V)"
  KEEP_WEEKS["${WEEK_KEY}"]=1
done

while IFS= read -r -d '' ARCHIVE; do
  FNAME="$(basename "${ARCHIVE}")"
  # Archive name format: engram_backup_YYYYMMDD_HHMMSS.tar.gz
  # grep -oE (POSIX) instead of grep -oP (PCRE) for BusyBox/BSD grep portability.
  DATE_STR="$(echo "${FNAME}" | grep -oE '[0-9]{8}_[0-9]{6}' || true)"
  if [[ -z "${DATE_STR}" ]]; then continue; fi

  ARCHIVE_TS="$(date -d "${DATE_STR:0:8} ${DATE_STR:9:2}:${DATE_STR:11:2}:${DATE_STR:13:2}" +%s \
    2>/dev/null || date -j -f "%Y%m%d %H%M%S" "${DATE_STR:0:8} ${DATE_STR:9:6}" +%s 2>/dev/null || echo 0)"

  if [[ "${ARCHIVE_TS}" -eq 0 ]]; then continue; fi

  # Always keep if within the daily window.
  if [[ "${ARCHIVE_TS}" -ge "${DAILY_CUTOFF}" ]]; then
    echo "[retention] keep (daily)  ${FNAME}"
    continue
  fi

  # Within the weekly window: keep one per week.
  if [[ "${ARCHIVE_TS}" -ge "${WEEKLY_CUTOFF}" ]]; then
    WEEK_KEY="$(date -d "@${ARCHIVE_TS}" +%Y_W%V 2>/dev/null || date -r "${ARCHIVE_TS}" +%Y_W%V)"
    if [[ -n "${KEEP_WEEKS[${WEEK_KEY}]+x}" ]]; then
      echo "[retention] keep (weekly) ${FNAME}"
      unset 'KEEP_WEEKS['"${WEEK_KEY}"']'
    else
      echo "[retention] delete        ${FNAME}"
      rm -f "${ARCHIVE}"
    fi
    continue
  fi

  # Beyond weekly window: delete.
  echo "[retention] delete (old)  ${FNAME}"
  rm -f "${ARCHIVE}"

done < <(find "${BACKUP_DIR}" -maxdepth 1 -name "engram_backup_*.tar.gz" -print0 | sort -z)

echo "[retention] done ✓"
