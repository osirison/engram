import { Module, type DynamicModule } from '@nestjs/common';
import { DualWriteCoordinator } from './dual-write.service';
import { MigrationModule } from './migration.module';
import type { MigrationCheckpointBackend } from './migration.backend.interface';

/**
 * Module wiring for {@link DualWriteCoordinator}.
 *
 * The coordinator depends on:
 *
 *   - `LiteJsonStore` bound to {@link LITE_STORE_TOKEN} (provided by
 *     `@engram/memory-lite` — `MemoryLiteModule.forRoot()`).
 *   - `MigrationStateService` (provided by {@link MigrationModule.forRoot}).
 *   - `MemoryLtmService` from `@engram/memory-ltm` (already global via
 *     `MemoryLtmModule.forRoot(capabilities)`).
 *
 * The `@Optional()` injection of `MemoryLtmService` means the
 * coordinator still loads in profile-memory; in that profile
 * `shouldDualWrite()` returns `false` and the enterprise leg is a
 * no-op. The module is therefore safe to import in every profile.
 */
@Module({})
export class DualWriteModule {
  static forRoot(backend: MigrationCheckpointBackend): DynamicModule {
    return {
      module: DualWriteModule,
      imports: [MigrationModule.forRoot(backend)],
      providers: [DualWriteCoordinator],
      exports: [DualWriteCoordinator],
    };
  }
}
