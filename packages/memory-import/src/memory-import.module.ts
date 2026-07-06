import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { MemoryLtmModule } from '@engram/memory-ltm';
import type { ProfileCapabilities } from '@engram/config';
import { ImportLedgerService } from './ledger/import-ledger.service.js';
import { LinkResolver } from './links/link-resolver.service.js';
import { SecretScanner } from './secrets/secret-scanner.js';
import { MemoryImportService } from './memory-import.service.js';
import { ADAPTER_REGISTRY, buildAdapterRegistry } from './adapters/registry.js';

/**
 * Agentic memory import module (WP4). `forRoot` wires the full pipeline:
 * the ledger (T2), link resolver (T5), secret scanner (T4), the adapter
 * registry (T6–T11), and the orchestrator (T3) — over the profile-appropriate
 * `MemoryLtmService`. The CLI (T12) and the MCP tool (T13) import this.
 */
@Module({})
export class MemoryImportModule {
  static forRoot(capabilities: ProfileCapabilities): DynamicModule {
    return {
      module: MemoryImportModule,
      imports: [PrismaModule, MemoryLtmModule.forRoot(capabilities)],
      providers: [
        ImportLedgerService,
        LinkResolver,
        SecretScanner,
        MemoryImportService,
        { provide: ADAPTER_REGISTRY, useFactory: buildAdapterRegistry },
      ],
      exports: [MemoryImportService, ImportLedgerService, LinkResolver, SecretScanner],
    };
  }
}
