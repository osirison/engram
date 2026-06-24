import type { MigrationCheckpoint } from './migration.types';

/**
 * Storage backend for {@link MigrationCheckpoint} records.
 *
 * Profile-lite uses a file-backed JSON implementation; profile-enterprise
 * uses a Postgres implementation (added in a follow-on phase when the
 * MigrationCheckpoint Prisma model is wired). The interface is intentionally
 * narrow — the service depends only on `load`, `save`, and `clear`.
 */
export interface MigrationCheckpointBackend {
  /** Returns the active checkpoint for `id`, or `null` when none exists. */
  load(id: string): Promise<MigrationCheckpoint | null>;

  /**
   * Persist `checkpoint` atomically (write-to-tmp + rename for file
   * implementations; `UPDATE ... WHERE state=?` for SQL backends so the
   * call is idempotent under concurrent operators).
   */
  save(checkpoint: MigrationCheckpoint): Promise<void>;

  /**
   * Remove the checkpoint with `id`. No-op when none exists. Used after
   * `completeMigration()` to clean up or after a successful rollback.
   */
  clear(id: string): Promise<void>;
}
