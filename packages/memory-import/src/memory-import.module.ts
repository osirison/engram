import { Module } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { ImportLedgerService } from './ledger/import-ledger.service.js';

/**
 * Agentic memory import module (WP4). Currently wires the idempotency ledger
 * (T2); the orchestration pipeline (T3), secret scanner (T4), link resolver
 * (T5), adapter registry (T6–T11), and cost estimator (T14) are added as those
 * tasks land. Kept dependency-light (Prisma only) until then.
 */
@Module({
  imports: [PrismaModule],
  providers: [ImportLedgerService],
  exports: [ImportLedgerService],
})
export class MemoryImportModule {}
