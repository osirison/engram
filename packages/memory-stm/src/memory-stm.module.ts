import { Module, type DynamicModule, Logger } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { EmbeddingsModule } from '@engram/embeddings';
import { MemoryStmService } from './memory-stm.service.js';
import { InMemoryStmAdapter } from './adapters/inmemory-stm.adapter.js';
import { PostgresStmAdapter } from './adapters/postgres-stm.adapter.js';
import type { ProfileCapabilities } from '@engram/config';

/**
 * Token that resolves to whichever STM implementation is active for the
 * current deployment profile. Database-bearing profiles use the
 * Postgres-backed `PostgresStmAdapter` (STM rows live in the shared
 * `memories` table and survive restarts); `InMemoryStmAdapter` is used for
 * profile-memory so it boots with zero external dependencies.
 */
export const STM_PROVIDER = Symbol.for('engram.memory-stm.provider');

const logger = new Logger('MemoryStmModule');

/**
 * Profile-aware STM module factory.
 *
 * The selected implementation is bound to the {@link STM_PROVIDER} symbol
 * so consumers can inject a single type-agnostic handle. The selected
 * adapter is also bound to the legacy `MemoryStmService` class token so
 * existing consumers that inject `MemoryStmService` keep resolving a
 * compatible implementation.
 */
@Module({})
export class MemoryStmModule {
  static forRoot(capabilities: ProfileCapabilities): DynamicModule {
    const usePostgres = capabilities.requiresDatabase;

    if (usePostgres) {
      logger.log(`Profile=${capabilities.profile}: wiring Postgres STM adapter`);
    } else {
      logger.log(
        `Profile=${capabilities.profile}: wiring in-process STM adapter (no database required)`
      );
    }

    return {
      module: MemoryStmModule,
      imports: usePostgres ? [PrismaModule, EmbeddingsModule] : [EmbeddingsModule],
      providers: usePostgres
        ? [
            PostgresStmAdapter,
            {
              provide: STM_PROVIDER,
              useExisting: PostgresStmAdapter,
            },
            {
              provide: MemoryStmService,
              useExisting: PostgresStmAdapter,
            },
          ]
        : [
            InMemoryStmAdapter,
            {
              provide: STM_PROVIDER,
              useExisting: InMemoryStmAdapter,
            },
            {
              provide: MemoryStmService,
              useExisting: InMemoryStmAdapter,
            },
          ],
      exports: usePostgres
        ? [STM_PROVIDER, MemoryStmService, PostgresStmAdapter]
        : [STM_PROVIDER, MemoryStmService, InMemoryStmAdapter],
    };
  }
}
