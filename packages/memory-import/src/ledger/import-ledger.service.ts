// Import idempotency ledger service (WP4 PLAN §T2 / D3). A thin, typed wrapper
// over the `memory_import_sources` table that answers "have I imported this
// source before, and at what content hash?" as an indexed point-lookup on
// `(userId, sourceKey)` — the basis for the pipeline's skip/update/create
// decision (D1). Modeled on `MemoryAuditService` (WP2/SHARED-2).

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import type { SourceTool } from '../ir/types.js';

/** One persisted ledger row. */
export interface LedgerEntry {
  id: string;
  userId: string;
  memoryId: string;
  sourceTool: SourceTool;
  sourcePath: string;
  sourceKey: string;
  contentHash: string;
  importBatchId: string;
  importedAt: Date;
  updatedAt: Date;
}

/** Fields required to record (or refresh) a ledger row. */
export interface UpsertLedgerInput {
  userId: string;
  memoryId: string;
  sourceTool: SourceTool;
  sourcePath: string;
  sourceKey: string;
  contentHash: string;
  importBatchId: string;
}

function toEntry(row: {
  id: string;
  userId: string;
  memoryId: string;
  sourceTool: string;
  sourcePath: string;
  sourceKey: string;
  contentHash: string;
  importBatchId: string;
  importedAt: Date;
  updatedAt: Date;
}): LedgerEntry {
  return { ...row, sourceTool: row.sourceTool as SourceTool };
}

@Injectable()
export class ImportLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Indexed point-lookup: the ledger row for `(userId, sourceKey)`, or null. */
  async find(userId: string, sourceKey: string): Promise<LedgerEntry | null> {
    const row = await this.prisma.memoryImportSource.findUnique({
      where: { userId_sourceKey: { userId, sourceKey } },
    });
    return row ? toEntry(row) : null;
  }

  /**
   * Record a first import or refresh an existing one. On re-import of the same
   * `sourceKey`, updates `contentHash`, `memoryId`, and `importBatchId` (drift
   * detection depends on the stored hash staying current).
   */
  async upsert(input: UpsertLedgerInput): Promise<LedgerEntry> {
    const row = await this.prisma.memoryImportSource.upsert({
      where: { userId_sourceKey: { userId: input.userId, sourceKey: input.sourceKey } },
      create: {
        userId: input.userId,
        memoryId: input.memoryId,
        sourceTool: input.sourceTool,
        sourcePath: input.sourcePath,
        sourceKey: input.sourceKey,
        contentHash: input.contentHash,
        importBatchId: input.importBatchId,
      },
      update: {
        memoryId: input.memoryId,
        sourceTool: input.sourceTool,
        sourcePath: input.sourcePath,
        contentHash: input.contentHash,
        importBatchId: input.importBatchId,
      },
    });
    return toEntry(row);
  }

  /** All ledger rows for a user whose content matches `contentHash`. */
  async findByContentHash(userId: string, contentHash: string): Promise<LedgerEntry[]> {
    const rows = await this.prisma.memoryImportSource.findMany({
      where: { userId, contentHash },
    });
    return rows.map(toEntry);
  }

  /**
   * Every ledger row for a user — the cross-run locator index the link resolver
   * (T5 Pass B) builds in memory to resolve `slug:`/`path:` targets imported in
   * an earlier batch. One row per imported fact, so bounded by the user's corpus.
   */
  async listByUser(userId: string): Promise<LedgerEntry[]> {
    const rows = await this.prisma.memoryImportSource.findMany({ where: { userId } });
    return rows.map(toEntry);
  }

  /** All ledger rows written under one import batch (for summaries/audits). */
  async listBatch(importBatchId: string): Promise<LedgerEntry[]> {
    const rows = await this.prisma.memoryImportSource.findMany({
      where: { importBatchId },
    });
    return rows.map(toEntry);
  }
}
