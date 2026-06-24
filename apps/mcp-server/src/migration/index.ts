export {
  MigrationStateService,
  MIGRATION_BACKEND,
  DEFAULT_MIGRATION_ID,
  selectCheckpointBackend,
  type CheckpointMigrationInput,
  type SelectCheckpointBackendOptions,
} from './migration-state.service';
export { MigrationModule } from './migration.module';
export { FileCheckpointBackend } from './file-checkpoint.backend';
export { PostgresCheckpointBackend } from './postgres-checkpoint.backend';
export type { MigrationCheckpointBackend } from './migration.backend.interface';
export {
  MIGRATION_STATES,
  migrationCheckpointSchema,
  MigrationCheckpointNotFoundError,
  InvalidMigrationTransitionError,
  assertCanTransition,
  nextStates,
  type MigrationCheckpoint,
  type MigrationState,
} from './migration.types';
export {
  DualWriteCoordinator,
  computeContentHash,
  type DualWriteCreateInput,
  type DualWriteUpdateInput,
  type DualWriteResult,
} from './dual-write.service';
export { DualWriteModule } from './dual-write.module';
export {
  BackfillService,
  encodeCursor,
  decodeCursor,
  computeLiteManifestHash,
  type BackfillOptions,
  type BackfillSummary,
} from './backfill.service';
export {
  VerifierService,
  DEFAULT_HARD_STOP_FRACTION,
  hashMemory,
  type VerifierOptions,
  type VerifierReport,
  type VerifierUserReport,
} from './verifier.service';
export {
  enumerateLiteUsers,
  countLiteMemories,
  listLitePage,
  type LiteEnumeratorPage,
} from './lite-enumerator';
// Re-export `LiteJsonStore` so test specs that import the migration
// surface can construct an in-process store without a second import
// site. This mirrors the public surface the `DualWriteCoordinator`
// already pulls from `@engram/memory-lite`.
export { LiteJsonStore } from '@engram/memory-lite';
