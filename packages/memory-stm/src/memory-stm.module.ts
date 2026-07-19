import { Module, type DynamicModule, Logger } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { EmbeddingsModule } from '@engram/embeddings';
import { PostgresStmAdapter } from './adapters/postgres-stm.adapter.js';
import type { ProfileCapabilities } from '@engram/config';

/**
 * Token that resolves to the active STM implementation. Every profile is
 * database-bearing, so this is always the Postgres-backed
 * `PostgresStmAdapter` (STM rows live in the shared `memories` table and
 * survive restarts).
 */
export const STM_PROVIDER = Symbol.for('engram.memory-stm.provider');

const logger = new Logger('MemoryStmModule');

/**
 * STM module factory. The adapter is bound to the {@link STM_PROVIDER}
 * symbol so consumers inject a single type-agnostic handle.
 */
@Module({})
export class MemoryStmModule {
  static forRoot(capabilities: ProfileCapabilities): DynamicModule {
    logger.log(`Profile=${capabilities.profile}: wiring Postgres STM adapter`);

    return {
      module: MemoryStmModule,
      imports: [PrismaModule, EmbeddingsModule],
      providers: [
        PostgresStmAdapter,
        {
          provide: STM_PROVIDER,
          useExisting: PostgresStmAdapter,
        },
      ],
      exports: [STM_PROVIDER, PostgresStmAdapter],
    };
  }
}
