import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  assertCanTransition,
  MigrationCheckpointNotFoundError,
  type MigrationCheckpoint,
  type MigrationState,
} from './migration.types';
import type { MigrationCheckpointBackend } from './migration.backend.interface';
import { FileCheckpointBackend } from './file-checkpoint.backend';
import { PostgresCheckpointBackend } from './postgres-checkpoint.backend';
import { DeploymentProfile, type ProfileCapabilities } from '@engram/config';
import type { PrismaService } from '@engram/database';

/**
 * Default migration id used by callers that don't care to mint their own.
 * Centralised here so tests and the CLI reach the same checkpoint.
 */
export const DEFAULT_MIGRATION_ID = 'default';

/**
 * Options accepted by {@link selectCheckpointBackend}.
 *
 * `capabilities` (preferred) drives the choice of backend. The caller
 * may also pass an explicit override via `forceBackend` (used by tests
 * that want to inject a `FileCheckpointBackend` even on enterprise
 * profile, e.g. to keep the temp dir off the Postgres host).
 */
export interface SelectCheckpointBackendOptions {
  capabilities?: ProfileCapabilities;
  /** Explicit override. Takes precedence over `capabilities`. */
  forceBackend?: MigrationCheckpointBackend;
  /** Required when selecting the Postgres backend and no override is supplied. */
  prisma?: PrismaService;
  /** Required when selecting the file backend. */
  dataDir?: string;
  /** Local data directory used by profile=memory when no file backend is configured. */
  defaultDataDir?: string;
}

/**
 * Select a {@link MigrationCheckpointBackend} implementation for the
 * active deployment profile.
 *
 * - `profile-memory`: in-process only, but the migration tooling never
 *   runs in this profile. Returns a `FileCheckpointBackend` rooted in
 *   `defaultDataDir` so the surface is still usable for tests.
 * - `profile-lite`:    file-backed JSON (`FileCheckpointBackend`).
 * - `profile-enterprise`: Postgres-backed (`PostgresCheckpointBackend`)
 *   so the migration checkpoint rides on the same authoritative store
 *   as the memory rows.
 *
 * Callers that need a different backend can supply `forceBackend`; the
 * helper is intentionally tolerant so migration controllers and tests
 * can both call it without branching.
 */
export function selectCheckpointBackend(
  options: SelectCheckpointBackendOptions,
): MigrationCheckpointBackend {
  if (options.forceBackend) {
    return options.forceBackend;
  }
  const profile = options.capabilities?.profile;
  if (profile === DeploymentProfile.ENTERPRISE) {
    if (!options.prisma) {
      throw new Error(
        'selectCheckpointBackend: enterprise profile requires a PrismaService instance.',
      );
    }
    return new PostgresCheckpointBackend(options.prisma);
  }
  const dataDir = options.dataDir ?? options.defaultDataDir;
  if (!dataDir) {
    throw new Error(
      `selectCheckpointBackend: profile=${String(profile)} requires a dataDir (or defaultDataDir).`,
    );
  }
  return new FileCheckpointBackend(dataDir);
}

/**
 * Injection token for the active {@link MigrationCheckpointBackend}.
 *
 * Wired by {@link MigrationModule.forRoot} to a file-backed
 * {@link FileCheckpointBackend} for profile-lite; a future Postgres-backed
 * implementation is planned for profile-enterprise.
 */
export const MIGRATION_BACKEND = Symbol.for('engram.migration.backend');

/**
 * Options accepted by {@link MigrationStateService.checkpointMigration}.
 */
export interface CheckpointMigrationInput {
  /** Caller-provided id; defaults to {@link DEFAULT_MIGRATION_ID}. */
  id?: string;
  /** Cursor token from the last completed backfill batch. */
  cursor: string | null;
  /** Number of items successfully processed so far. */
  progress: number;
  /** Total items expected; `null` when the backfill is unbounded. */
  totalItems?: number | null;
  /** Optional manifest hash captured at the start of the migration. */
  sourceManifestHash?: string | null;
}

/**
 * Service that owns the migration state machine.
 *
 * Public surface:
 *
 * - {@link checkpointMigration} — advance the state, recording a cursor
 *   and progress marker. Used by the backfill job after each batch.
 * - {@link resumeMigration} — load the current checkpoint for an id.
 * - {@link completeMigration} — transition to `complete`. Used after
 *   verification succeeds and the cutover is committed.
 * - {@link abortMigration} — transition to `rollback`. Used when the
 *   operator aborts or when an integrity check exceeds the threshold.
 *
 * Transitions are validated against the static map in
 * `migration.types.ts` so a programmer error (e.g. skipping `verifying`)
 * is caught at the service boundary rather than at runtime in the field.
 */
@Injectable()
export class MigrationStateService {
  private readonly logger = new Logger(MigrationStateService.name);

  constructor(
    @Optional()
    @Inject(MIGRATION_BACKEND)
    private readonly backend?: MigrationCheckpointBackend,
  ) {}

  /** Setter used by tests and ad-hoc composition. */
  setBackend(backend: MigrationCheckpointBackend): void {
    (this as unknown as { backend: MigrationCheckpointBackend }).backend =
      backend;
  }

  /**
   * Persist a new checkpoint at `state`, validating the transition.
   *
   * If no checkpoint exists yet for `id`, the service seeds one in
   * {@link MigrationState.idle} and then walks the transition from
   * `idle` to the requested state so existing call sites do not need to
   * know the initial state.
   */
  async checkpointMigration(
    state: MigrationState,
    input: CheckpointMigrationInput,
  ): Promise<MigrationCheckpoint> {
    const backend = this.requireBackend();
    const id = input.id ?? DEFAULT_MIGRATION_ID;
    const existing = await backend.load(id);

    const now = new Date().toISOString();
    if (!existing) {
      // Seed from `idle` so subsequent transitions are well-formed.
      assertCanTransition('idle', state);
      const seeded: MigrationCheckpoint = {
        id,
        sourceProfile: 'lite',
        targetProfile: 'enterprise',
        state,
        cursor: input.cursor,
        progress: input.progress,
        totalItems: input.totalItems ?? null,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        sourceManifestHash: input.sourceManifestHash ?? null,
        history: [
          {
            at: now,
            from: 'idle',
            to: state,
            note: 'initial checkpoint',
          },
        ],
      };
      await backend.save(seeded);
      this.logger.log(
        `migration=${id} transition=idle->${state} progress=${seeded.progress}`,
      );
      return seeded;
    }

    assertCanTransition(existing.state, state);
    const updated: MigrationCheckpoint = {
      ...existing,
      state,
      cursor: input.cursor,
      progress: input.progress,
      totalItems: input.totalItems ?? existing.totalItems,
      sourceManifestHash:
        input.sourceManifestHash ?? existing.sourceManifestHash,
      updatedAt: now,
      // Self-transitions (e.g. `copying → copying` while the backfill
      // streams new pages) only refresh the cursor and progress; we
      // do not append a history entry for them to keep the audit
      // trail readable. State-changing transitions still log a row.
      history:
        existing.state === state
          ? existing.history
          : [...existing.history, { at: now, from: existing.state, to: state }],
    };
    await backend.save(updated);
    this.logger.log(
      `migration=${id} transition=${existing.state}->${state} progress=${updated.progress}`,
    );
    return updated;
  }

  /**
   * Load the active checkpoint for `id`.
   *
   * Throws {@link MigrationCheckpointNotFoundError} when no checkpoint
   * exists; callers should treat this as "no migration in progress" and
   * seed one with {@link checkpointMigration} when they intend to start.
   */
  async resumeMigration(
    id: string = DEFAULT_MIGRATION_ID,
  ): Promise<MigrationCheckpoint> {
    const backend = this.requireBackend();
    const checkpoint = await backend.load(id);
    if (!checkpoint) {
      throw new MigrationCheckpointNotFoundError(id);
    }
    return checkpoint;
  }

  /**
   * Return the current state for an id, or `null` when no migration
   * has been seeded. Used by {@link DualWriteCoordinator} and the
   * verifier so they can branch on `copying` / `verifying` without
   * having to handle the not-found exception.
   */
  async currentState(
    id: string = DEFAULT_MIGRATION_ID,
  ): Promise<MigrationState | null> {
    const backend = this.requireBackend();
    const checkpoint = await backend.load(id);
    return checkpoint ? checkpoint.state : null;
  }

  /**
   * Return the full checkpoint for an id, or `null` when none exists.
   *
   * Distinguishes "no migration in progress" from "no checkpoint for
   * this id" without forcing callers to handle the typed error.
   */
  async tryLoad(
    id: string = DEFAULT_MIGRATION_ID,
  ): Promise<MigrationCheckpoint | null> {
    const backend = this.requireBackend();
    return backend.load(id);
  }

  /**
   * Mark the migration as `complete` and stamp `completedAt`.
   *
   * Idempotent: calling `completeMigration` on a checkpoint already in
   * `complete` returns the existing record without re-stamping.
   */
  async completeMigration(
    id: string = DEFAULT_MIGRATION_ID,
  ): Promise<MigrationCheckpoint> {
    const backend = this.requireBackend();
    const existing = await backend.load(id);
    if (!existing) {
      throw new MigrationCheckpointNotFoundError(id);
    }
    if (existing.state === 'complete') {
      return existing;
    }
    assertCanTransition(existing.state, 'complete');
    const now = new Date().toISOString();
    const updated: MigrationCheckpoint = {
      ...existing,
      state: 'complete',
      updatedAt: now,
      completedAt: now,
      history: [
        ...existing.history,
        { at: now, from: existing.state, to: 'complete' },
      ],
    };
    await backend.save(updated);
    this.logger.log(`migration=${id} transition=${existing.state}->complete`);
    return updated;
  }

  /**
   * Move the migration into `rollback`. Used both by operator aborts and
   * by the integrity verifier when the hard-stop threshold is crossed.
   *
   * Like {@link completeMigration}, this is idempotent for checkpoints
   * already in `rollback`.
   */
  async abortMigration(
    id: string = DEFAULT_MIGRATION_ID,
    note?: string,
  ): Promise<MigrationCheckpoint> {
    const backend = this.requireBackend();
    const existing = await backend.load(id);
    if (!existing) {
      throw new MigrationCheckpointNotFoundError(id);
    }
    if (existing.state === 'rollback') {
      return existing;
    }
    if (existing.state === 'complete') {
      throw new Error('Cannot rollback a completed migration.');
    }
    assertCanTransition(existing.state, 'rollback');
    const now = new Date().toISOString();
    const updated: MigrationCheckpoint = {
      ...existing,
      state: 'rollback',
      updatedAt: now,
      history: [
        ...existing.history,
        { at: now, from: existing.state, to: 'rollback', note },
      ],
    };
    await backend.save(updated);
    this.logger.warn(
      `migration=${id} transition=${existing.state}->rollback note=${note ?? 'n/a'}`,
    );
    return updated;
  }

  /**
   * Helper for tests: reset state for an id by removing the checkpoint.
   * Production callers should use {@link completeMigration} or
   * {@link abortMigration} instead; this method exists to keep the
   * testing ergonomics tight.
   */
  async _resetForTests(id: string = DEFAULT_MIGRATION_ID): Promise<void> {
    const backend = this.requireBackend();
    await backend.clear(id);
  }

  /**
   * Mint a fresh checkpoint id. Useful for the CLI when an operator
   * wants to fork a sandbox migration off the default checkpoint.
   */
  static newId(): string {
    return randomUUID();
  }

  private requireBackend(): MigrationCheckpointBackend {
    if (!this.backend) {
      throw new Error(
        'MigrationStateService has no backend configured. ' +
          'Wire MigrationModule.forRoot({ backend }) at startup.',
      );
    }
    return this.backend;
  }
}
