import { PrismaService } from '@engram/database';
import {
  migrationCheckpointSchema,
  type MigrationCheckpoint,
} from './migration.types';
import type { MigrationCheckpointBackend } from './migration.backend.interface';

/**
 * Postgres-backed implementation of {@link MigrationCheckpointBackend}.
 *
 * Used when the target profile is `enterprise` and Postgres is the
 * authoritative source of truth. Mirrors {@link FileCheckpointBackend}
 * semantics — atomic conditional writes, monotonic state machine — but
 * uses a single Prisma transaction so concurrent operators cannot
 * overwrite each other.
 *
 * The `history` JSON column is written as-is; the application-side Zod
 * schema re-validates the row on read so the Postgres representation
 * stays lenient (no enum migration needed when the lifecycle evolves).
 */
export class PostgresCheckpointBackend implements MigrationCheckpointBackend {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist `checkpoint`, refusing to clobber a row that has already
   * advanced beyond `checkpoint.state`. This keeps the state machine
   * monotonic when two operators race the same migration id.
   */
  async save(checkpoint: MigrationCheckpoint): Promise<void> {
    const parsed = migrationCheckpointSchema.parse(checkpoint);
    await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.migrationCheckpoint.findUnique({
          where: { id: parsed.id },
        });

        if (!existing) {
          await tx.migrationCheckpoint.create({
            data: {
              id: parsed.id,
              sourceProfile: parsed.sourceProfile,
              targetProfile: parsed.targetProfile,
              state: parsed.state,
              cursor: parsed.cursor,
              progress: parsed.progress,
              totalItems: parsed.totalItems,
              startedAt: new Date(parsed.startedAt),
              updatedAt: new Date(parsed.updatedAt),
              completedAt: parsed.completedAt
                ? new Date(parsed.completedAt)
                : null,
              sourceManifestHash: parsed.sourceManifestHash,
              history: parsed.history,
            },
          });
          return;
        }

        // Refuse to regress the state machine — caller's responsibility is
        // to validate transitions before calling `save`, but a defensive
        // guard here makes the intent explicit.
        if (!canAdvance(existing.state, parsed.state)) {
          throw new Error(
            `PostgresCheckpointBackend refused to regress state for ${parsed.id}: ` +
              `${existing.state} -> ${parsed.state}`,
          );
        }

        await tx.migrationCheckpoint.update({
          where: { id: parsed.id },
          data: {
            sourceProfile: parsed.sourceProfile,
            targetProfile: parsed.targetProfile,
            state: parsed.state,
            cursor: parsed.cursor,
            progress: parsed.progress,
            totalItems: parsed.totalItems,
            updatedAt: new Date(parsed.updatedAt),
            completedAt: parsed.completedAt
              ? new Date(parsed.completedAt)
              : null,
            sourceManifestHash: parsed.sourceManifestHash,
            history: parsed.history,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async load(id: string): Promise<MigrationCheckpoint | null> {
    const row = await this.prisma.migrationCheckpoint.findUnique({
      where: { id },
    });
    if (!row) return null;
    return migrationCheckpointSchema.parse({
      id: row.id,
      sourceProfile: row.sourceProfile,
      targetProfile: row.targetProfile,
      state: row.state,
      cursor: row.cursor,
      progress: row.progress,
      totalItems: row.totalItems,
      startedAt: row.startedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      sourceManifestHash: row.sourceManifestHash,
      history: Array.isArray(row.history) ? row.history : [],
    });
  }

  async clear(id: string): Promise<void> {
    await this.prisma.migrationCheckpoint
      .delete({ where: { id } })
      .catch((error: unknown) => {
        // Treat "not found" as a no-op so callers can use `clear()` as a
        // best-effort cleanup without first checking for existence.
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: string }).code === 'P2025'
        ) {
          return;
        }
        throw error;
      });
  }
}

/**
 * Compare two lifecycle states and return `true` when `next` is a legal
 * successor of `current`. Mirrors the table in `migration.types.ts` but
 * works against raw strings so the SQL representation does not need to
 * track the closed enum set.
 */
function canAdvance(current: string, next: string): boolean {
  const order: Record<string, number> = {
    idle: 0,
    preparing: 1,
    copying: 2,
    verifying: 3,
    cutting_over: 4,
    complete: 5,
    rollback: -1,
  };
  const cur = order[current];
  const nxt = order[next];
  if (cur === undefined || nxt === undefined) {
    // Unknown state — refuse to clobber; force caller to validate.
    return false;
  }
  // Rollback is reachable from any non-terminal state but is itself
  // terminal; we treat it as a regression from the operator's view.
  if (nxt === -1) return true;
  return nxt >= cur;
}
