import { z } from 'zod';

/**
 * Stable names for the migration lifecycle states.
 *
 * The state machine is intentionally linear so callers can reason about
 * promotion progress from logs and dashboards without an exhaustive
 * mapping table:
 *
 *   idle       → preparing   (operator triggers promotion)
 *   preparing  → copying     (dual-write arming complete)
 *   copying    → verifying   (backfill batches flushed)
 *   verifying  → cutting_over  (integrity report clean)
 *   cutting_over → complete  (cutover committed; source becomes shadow)
 *   {any}      → rollback    (operator abort or integrity hard-stop)
 *   rollback   → idle        (rolled back; original profile is primary)
 *
 * `cutover_window` is the only transient sub-state: while in
 * `cutting_over`, reads must continue to hit the source so no requests
 * see a partially populated target. Operators should keep this window
 * under the 2-minute SLO target (see plan §Success Criteria).
 */
export const MIGRATION_STATES = [
  'idle',
  'preparing',
  'copying',
  'verifying',
  'cutting_over',
  'complete',
  'rollback',
] as const;

export type MigrationState = (typeof MIGRATION_STATES)[number];

/** Allowed transitions for the migration state machine. */
const ALLOWED_TRANSITIONS: Readonly<
  Record<MigrationState, ReadonlyArray<MigrationState>>
> = {
  idle: ['preparing'],
  preparing: ['copying', 'rollback'],
  copying: ['verifying', 'rollback', 'copying'],
  verifying: ['cutting_over', 'rollback'],
  cutting_over: ['complete', 'rollback'],
  complete: [],
  rollback: ['idle'],
};

/** Persistent shape of a migration checkpoint. */
export const migrationCheckpointSchema = z
  .object({
    id: z.string().min(1),
    sourceProfile: z.enum(['memory', 'lite']),
    // 'enterprise' is the legacy name persisted by pre-simplification
    // checkpoints; new checkpoints write 'standard'.
    targetProfile: z.enum(['standard', 'enterprise']),
    state: z.enum(MIGRATION_STATES),
    cursor: z.string().nullable(),
    progress: z.number().int().min(0),
    totalItems: z.number().int().nullable(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    /**
     * Hash of the source manifest when the checkpoint was taken. Lets
     * verifiers detect changes to the source dataset between checkpoints
     * and abort the migration if the drift exceeds the integrity budget.
     */
    sourceManifestHash: z.string().nullable(),
    /**
     * Free-form audit trail. We log enough detail to reconstruct operator
     * decisions without forcing a strict schema; values must still be
     * JSON-serialisable so the file-backed backend can round-trip them.
     */
    history: z
      .array(
        z.object({
          at: z.string().datetime(),
          from: z.enum(MIGRATION_STATES),
          to: z.enum(MIGRATION_STATES),
          note: z.string().optional(),
        }),
      )
      .default([]),
  })
  .strict();

export type MigrationCheckpoint = z.infer<typeof migrationCheckpointSchema>;

/** Error raised when the requested state transition is not allowed. */
export class InvalidMigrationTransitionError extends Error {
  constructor(from: MigrationState, to: MigrationState) {
    super(`Invalid migration transition: ${from} → ${to}`);
    this.name = 'InvalidMigrationTransitionError';
  }
}

/** Error raised when a checkpoint cannot be loaded. */
export class MigrationCheckpointNotFoundError extends Error {
  constructor(id: string) {
    super(`Migration checkpoint not found: ${id}`);
    this.name = 'MigrationCheckpointNotFoundError';
  }
}

/** Return the list of legal successors for a given state. */
export function nextStates(
  from: MigrationState,
): ReadonlyArray<MigrationState> {
  return ALLOWED_TRANSITIONS[from];
}

/** Throws when the transition is not in {@link ALLOWED_TRANSITIONS}. */
export function assertCanTransition(
  from: MigrationState,
  to: MigrationState,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidMigrationTransitionError(from, to);
  }
}
