/**
 * D7 newest-wins conflict decision for the file-watcher sync bridge.
 *
 * A memory that was imported from a native file, then later edited inside ENGRAM
 * (via the UI or another agent), has `updatedAt` materially newer than the last
 * time the importer touched it (the ledger row's `updatedAt`). Re-importing the
 * file would clobber that edit, so we treat it as a conflict and refuse to
 * overwrite. A small skew absorbs the millisecond gap between the memory write
 * and the ledger write within a single import run.
 */
export function isEngramNewer(
  memoryUpdatedAt: Date,
  lastImportAt: Date,
  skewMs = 5000,
): boolean {
  return memoryUpdatedAt.getTime() > lastImportAt.getTime() + skewMs;
}
