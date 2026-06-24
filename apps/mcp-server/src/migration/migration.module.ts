import { Module, type DynamicModule } from '@nestjs/common';
import { MigrationStateService } from './migration-state.service';
import type { MigrationCheckpointBackend } from './migration.backend.interface';

/**
 * Nest module that wires the migration state service.
 *
 * Callers supply a {@link MigrationCheckpointBackend} implementation.
 * `apps/mcp-server/src/main.ts` (and any future Postgres-backed wiring)
 * passes a {@link FileCheckpointBackend} for profile-lite; profile-enterprise
 * will swap in a SQL implementation when the MigrationCheckpoint Prisma
 * model lands.
 */
@Module({})
export class MigrationModule {
  static forRoot(backend: MigrationCheckpointBackend): DynamicModule {
    return {
      module: MigrationModule,
      providers: [
        {
          provide: Symbol.for('engram.migration.backend'),
          useValue: backend,
        },
        MigrationStateService,
      ],
      exports: [MigrationStateService],
    };
  }
}
