import { Module, type DynamicModule, Logger } from '@nestjs/common';
import { RedisModule } from '@engram/redis';
import { EmbeddingsModule } from '@engram/embeddings';
import { MemoryStmService } from './memory-stm.service.js';
import { InMemoryStmAdapter } from './adapters/inmemory-stm.adapter.js';
import type { ProfileCapabilities } from '@engram/config';

/**
 * Token that resolves to whichever STM implementation is active for the
 * current deployment profile. The Redis-backed `MemoryStmService` is
 * used for profile-enterprise / profile-lite; `InMemoryStmAdapter` is
 * used for profile-memory so the process can boot with no external
 * services.
 */
export const STM_PROVIDER = Symbol.for('engram.memory-stm.provider');

const logger = new Logger('MemoryStmModule');

/**
 * Profile-aware STM module factory.
 *
 * The selected implementation is bound to the {@link STM_PROVIDER} symbol
 * so consumers can inject a single type-agnostic handle. The legacy
 * `MemoryStmModule` (default export) is still usable for tests and
 * non-profile consumers.
 */
@Module({})
export class MemoryStmModule {
  static forRoot(capabilities: ProfileCapabilities): DynamicModule {
    const useInProcess = !capabilities.requiresRedis;

    if (useInProcess) {
      logger.log(
        `Profile=${capabilities.profile}: wiring in-process STM adapter (no Redis required)`
      );
    }

    return {
      module: MemoryStmModule,
      imports: useInProcess ? [EmbeddingsModule] : [RedisModule.forRoot(), EmbeddingsModule],
      providers: useInProcess
        ? [
            InMemoryStmAdapter,
            {
              provide: STM_PROVIDER,
              useExisting: InMemoryStmAdapter,
            },
            {
              // Backward-compatible export: re-export the in-process
              // adapter under the MemoryStmService class token so existing
              // consumers that inject `MemoryStmService` continue to
              // resolve a compatible interface in profile-memory.
              provide: MemoryStmService,
              useExisting: InMemoryStmAdapter,
            },
          ]
        : [
            MemoryStmService,
            {
              provide: STM_PROVIDER,
              useExisting: MemoryStmService,
            },
          ],
      exports: useInProcess
        ? [STM_PROVIDER, MemoryStmService, InMemoryStmAdapter]
        : [STM_PROVIDER, MemoryStmService],
    };
  }
}
