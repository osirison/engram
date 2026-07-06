import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import {
  ImportLedgerService,
  MemoryImportService,
  type ImportRunInput,
  type ImportSummary,
  type SourceTool,
} from '@engram/memory-import';

import { isEngramNewer } from './conflict';

export interface SyncSpec {
  source: SourceTool;
  /** Filesystem root passed to the importer (repo root or a home dir). */
  root: string;
  userId: string;
  scope?: string;
}

export interface SyncConflict {
  memoryId: string;
  sourcePath: string;
  sourceKey: string;
}

export interface SyncResult {
  source: SourceTool;
  root: string;
  /** True when the import was skipped because a newer ENGRAM edit would be clobbered. */
  skipped: boolean;
  conflicts: SyncConflict[];
  summary: ImportSummary | null;
}

export interface SyncOptions {
  /** Import even when conflicts are detected (operator override). */
  force?: boolean;
  /** Passed through to the importer (default true). */
  embed?: boolean;
  /** Clock skew tolerance for the conflict check. */
  skewMs?: number;
}

/**
 * Conflict-aware wrapper around the WP4 importer (`MemoryImportService`) for the
 * file-watcher sync bridge (WP5 T11). It reuses WP4's parsing, dedup, provenance,
 * and link resolution unchanged, and adds the D7 rule: a native file is never
 * allowed to clobber a memory that was edited more recently inside ENGRAM.
 */
@Injectable()
export class MemorySyncService {
  private readonly logger = new Logger(MemorySyncService.name);

  constructor(
    private readonly importService: MemoryImportService,
    private readonly ledger: ImportLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  async syncSource(
    spec: SyncSpec,
    options: SyncOptions = {},
  ): Promise<SyncResult> {
    const conflicts = await this.detectConflicts(spec, options.skewMs);

    if (conflicts.length > 0 && options.force !== true) {
      for (const conflict of conflicts) {
        this.logger.warn(
          `sync conflict: memory ${conflict.memoryId} (${conflict.sourcePath}) was edited in ENGRAM ` +
            `after its last import — skipping ${spec.source} sync to avoid clobbering. ` +
            `Reconcile in the UI or re-run with force.`,
        );
      }
      return {
        source: spec.source,
        root: spec.root,
        skipped: true,
        conflicts,
        summary: null,
      };
    }

    const input: ImportRunInput = {
      source: spec.source,
      path: spec.root,
      userId: spec.userId,
      ...(spec.scope !== undefined ? { scope: spec.scope } : {}),
      ...(options.embed !== undefined ? { embed: options.embed } : {}),
    };
    const summary = await this.importService.run(input);
    this.logger.log(
      `synced ${spec.source} from ${spec.root}: created=${summary.created} updated=${summary.updated} ` +
        `skipped=${summary.skipped} merged=${summary.mergedIntoExisting}`,
    );
    return {
      source: spec.source,
      root: spec.root,
      skipped: false,
      conflicts,
      summary,
    };
  }

  /** Find already-imported memories for this source that ENGRAM has since edited. */
  private async detectConflicts(
    spec: SyncSpec,
    skewMs?: number,
  ): Promise<SyncConflict[]> {
    const entries = (await this.ledger.listByUser(spec.userId)).filter(
      (e) => e.sourceTool === spec.source,
    );
    if (entries.length === 0) return [];

    // One query for all candidate memories (avoids an N+1 per ledger entry).
    const memories = await this.prisma.memory.findMany({
      where: { id: { in: entries.map((e) => e.memoryId) } },
      select: { id: true, updatedAt: true },
    });
    const updatedById = new Map(memories.map((m) => [m.id, m.updatedAt]));

    const conflicts: SyncConflict[] = [];
    for (const entry of entries) {
      const updatedAt = updatedById.get(entry.memoryId);
      if (updatedAt && isEngramNewer(updatedAt, entry.updatedAt, skewMs)) {
        conflicts.push({
          memoryId: entry.memoryId,
          sourcePath: entry.sourcePath,
          sourceKey: entry.sourceKey,
        });
      }
    }
    return conflicts;
  }
}
