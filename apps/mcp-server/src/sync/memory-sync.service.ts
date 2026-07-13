import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import { MemoryLtmService } from '@engram/memory-ltm';
import {
  ImportLedgerService,
  MemoryImportService,
  computeContentHash,
  type ImportRunInput,
  type ImportSummary,
  type ParsedSyncFact,
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
  /** The ledger's last-imported content hash (drift baseline for the copy). */
  lastImportedHash: string;
}

/** What happened to the D7 `conflict`-tagged file copies during one sync. */
export interface ConflictCopySummary {
  /** New conflict copies stored (one per contested memory). */
  created: number;
  /** Existing copies refreshed in place because the file moved on (no pile-up). */
  updated: number;
  /** Copies already carrying the file's current content (idempotent re-run). */
  unchanged: number;
  /** Stale copies removed because their conflict is no longer detected. */
  removedStale: number;
}

export interface SyncResult {
  source: SourceTool;
  root: string;
  /** True when the import was skipped because a newer ENGRAM edit would be clobbered. */
  skipped: boolean;
  conflicts: SyncConflict[];
  summary: ImportSummary | null;
  conflictCopies: ConflictCopySummary;
}

export interface SyncOptions {
  /** Import even when conflicts are detected (operator override). */
  force?: boolean;
  /** Passed through to the importer (default true). */
  embed?: boolean;
  /** Clock skew tolerance for the conflict check. */
  skewMs?: number;
}

/** Tag every D7 file-version copy carries — the review surface filters on it. */
export const CONFLICT_COPY_TAG = 'conflict';
/**
 * Dedicated namespace for conflict copies. Keeps them out of normal recall
 * scopes (no double-hit of contradictory facts) and bounds the LTM
 * exact-content dedup to other copies, which is exactly the idempotency we
 * want for re-stored identical file versions.
 */
export const CONFLICT_COPY_SCOPE = 'sync-conflict';

/** `metadata.conflict` payload on a copy — links it to the contested memory. */
interface ConflictCopyMeta {
  memoryId: string;
  sourceTool: string;
  sourceKey: string;
  sourcePath: string;
  root: string;
  contentHash: string;
  detectedAt: string;
}

function emptyCopySummary(): ConflictCopySummary {
  return { created: 0, updated: 0, unchanged: 0, removedStale: 0 };
}

/** Best-effort read of `metadata.conflict` from a stored copy row. */
function readConflictMeta(metadata: unknown): Partial<ConflictCopyMeta> | null {
  if (metadata === null || typeof metadata !== 'object') return null;
  const conflict = (metadata as Record<string, unknown>)['conflict'];
  if (conflict === null || typeof conflict !== 'object') return null;
  return conflict;
}

/**
 * Conflict-aware wrapper around the WP4 importer (`MemoryImportService`) for the
 * file-watcher sync bridge (WP5 T11). It reuses WP4's parsing, dedup, provenance,
 * and link resolution unchanged, and adds the D7 rule: a native file is never
 * allowed to clobber a memory that was edited more recently inside ENGRAM.
 *
 * D7 conflict handling (#239): the contested source's import is still skipped
 * (never clobbers), but the FILE's version of each genuinely-diverged fact is
 * stored as a separate `conflict`-tagged memory in the `sync-conflict` scope,
 * linked to the contested memory via `metadata.conflict.memoryId` — so nothing
 * is lost and the review surface can show both sides. At most ONE live copy
 * exists per contested memory (a further file edit refreshes it in place), and
 * once the conflict clears (a later sync imports/reconciles the source), the
 * stale copy is removed.
 */
@Injectable()
export class MemorySyncService {
  private readonly logger = new Logger(MemorySyncService.name);

  constructor(
    private readonly importService: MemoryImportService,
    private readonly ledger: ImportLedgerService,
    private readonly prisma: PrismaService,
    private readonly ltm: MemoryLtmService,
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
      // D7 (#239): preserve the file's version for review — never the import.
      const conflictCopies = await this.storeConflictCopies(spec, conflicts);
      return {
        source: spec.source,
        root: spec.root,
        skipped: true,
        conflicts,
        summary: null,
        conflictCopies,
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
        `skipped=${summary.skipped} merged=${summary.mergedIntoExisting} ` +
        `skippedConcurrentEdit=${summary.skippedConcurrentEdit} reconciled=${summary.reconciled}`,
    );
    if (summary.skippedConcurrentEdit > 0) {
      // Per-row CAS backstop (G4-T3): even a forced sync cannot clobber a
      // memory edited in ENGRAM after its last import — those rows are skipped.
      this.logger.warn(
        `${summary.skippedConcurrentEdit} fact(s) kept their ENGRAM edit (CAS-skip) — ` +
          `reconcile in the UI or update the source file`,
      );
    }
    // #239: drop copies whose conflict no longer exists after this import
    // (re-imported or reconciled) so resolved conflicts leave no residue.
    const conflictCopies = await this.cleanupResolvedCopies(
      spec,
      options.skewMs,
    );
    return {
      source: spec.source,
      root: spec.root,
      skipped: false,
      conflicts,
      summary,
      conflictCopies,
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
          lastImportedHash: entry.contentHash,
        });
      }
    }
    return conflicts;
  }

  // ── D7 conflict copies (#239) ─────────────────────────────────────────────

  /**
   * Store the FILE's version of each conflicted fact as a `conflict`-tagged
   * memory. Idempotent: keyed on (contested memoryId, file contentHash) — a
   * re-run over the same unresolved conflict is a no-op, and a further file
   * edit refreshes the single existing copy in place instead of piling up.
   * Copies are only stored for real divergence: a fact whose file content
   * still matches the last import (memory-only edit), or already matches the
   * memory's current content (reconciled by hand), gets no copy.
   * Never throws — a copy failure must not break the skip path.
   */
  private async storeConflictCopies(
    spec: SyncSpec,
    conflicts: SyncConflict[],
  ): Promise<ConflictCopySummary> {
    const summary = emptyCopySummary();
    let facts: ParsedSyncFact[];
    try {
      facts = await this.importService.parseFacts({
        source: spec.source,
        path: spec.root,
      });
    } catch (err) {
      this.logger.warn(
        `could not parse ${spec.source} at ${spec.root} for conflict copies: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return summary;
    }
    const byLedgerKey = new Map(facts.map((f) => [f.ledgerKey, f]));
    const byBareKey = new Map(facts.map((f) => [f.sourceKey, f]));

    // Current contents of the contested memories, to skip already-reconciled facts.
    const contested = await this.prisma.memory.findMany({
      where: { id: { in: conflicts.map((c) => c.memoryId) } },
      select: { id: true, content: true },
    });
    const contentById = new Map(contested.map((m) => [m.id, m.content]));

    for (const conflict of conflicts) {
      // Ledger keys are root-namespaced (#236); pre-migration rows are bare.
      const fact =
        byLedgerKey.get(conflict.sourceKey) ??
        byBareKey.get(conflict.sourceKey);
      if (!fact) continue; // fact no longer present in the file — nothing to copy
      if (fact.contentHash === conflict.lastImportedHash) continue; // memory-only edit
      const memoryContent = contentById.get(conflict.memoryId);
      if (
        memoryContent !== undefined &&
        computeContentHash(memoryContent) === fact.contentHash
      ) {
        continue; // file already matches ENGRAM — a copy would duplicate the memory
      }
      try {
        await this.upsertConflictCopy(spec, conflict, fact, summary);
      } catch (err) {
        this.logger.warn(
          `failed to store conflict copy for memory ${conflict.memoryId}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return summary;
  }

  /** Create or refresh THE single conflict copy for one contested memory. */
  private async upsertConflictCopy(
    spec: SyncSpec,
    conflict: SyncConflict,
    fact: ParsedSyncFact,
    summary: ConflictCopySummary,
  ): Promise<void> {
    const meta: ConflictCopyMeta = {
      memoryId: conflict.memoryId,
      sourceTool: spec.source,
      sourceKey: conflict.sourceKey,
      sourcePath: fact.sourcePath,
      root: spec.root,
      contentHash: fact.contentHash,
      detectedAt: new Date().toISOString(),
    };

    const existing = await this.findConflictCopy(
      spec.userId,
      conflict.memoryId,
    );
    if (existing) {
      const existingMeta = readConflictMeta(existing.metadata);
      if (existingMeta?.contentHash === fact.contentHash) {
        summary.unchanged++; // idempotent re-run of the same unresolved conflict
        return;
      }
      // The file moved on while still conflicted — refresh the ONE copy in
      // place (latest file version wins for review; no second copy).
      await this.ltm.update(
        spec.userId,
        existing.id,
        { content: fact.content, metadataMerge: { conflict: meta } },
        undefined,
        CONFLICT_COPY_SCOPE,
      );
      summary.updated++;
      this.logger.log(
        `refreshed conflict copy ${existing.id} for memory ${conflict.memoryId} (${fact.sourcePath})`,
      );
      return;
    }

    const created = await this.ltm.create({
      userId: spec.userId,
      scope: CONFLICT_COPY_SCOPE,
      content: fact.content,
      tags: [CONFLICT_COPY_TAG, spec.source],
      metadata: {
        title: `Sync conflict copy: ${fact.sourcePath}`,
        conflict: meta,
      },
      // Verbatim review snapshot: never collapse into a semantic near-duplicate.
      skipDuplicateCheck: true,
    });
    // Exact-content dedup inside the conflict scope can hand back an existing
    // copy (same file content contested under two memories) — count it as
    // unchanged rather than pretending a second copy exists.
    const createdMeta = readConflictMeta(created.metadata);
    if (createdMeta?.memoryId === conflict.memoryId) {
      summary.created++;
      this.logger.warn(
        `stored conflict copy ${created.id} of ${fact.sourcePath} for contested memory ` +
          `${conflict.memoryId} — review with tag '${CONFLICT_COPY_TAG}'`,
      );
    } else {
      summary.unchanged++;
    }
  }

  /** The single live copy for a contested memory (keyed on metadata.conflict.memoryId). */
  private async findConflictCopy(
    userId: string,
    contestedMemoryId: string,
  ): Promise<{ id: string; metadata: unknown } | null> {
    return this.prisma.memory.findFirst({
      where: {
        userId,
        scope: CONFLICT_COPY_SCOPE,
        tags: { has: CONFLICT_COPY_TAG },
        metadata: { path: ['conflict', 'memoryId'], equals: contestedMemoryId },
      },
      select: { id: true, metadata: true },
    });
  }

  /**
   * After a sync that actually imported (no conflicts, or forced), remove the
   * copies whose conflict is GONE — the source was re-imported or reconciled
   * (ledger refreshed), so the copy's content is either imported or obsolete.
   * Copies whose conflict persists (e.g. a forced run that CAS-skipped the
   * row) are kept. Never throws.
   */
  private async cleanupResolvedCopies(
    spec: SyncSpec,
    skewMs?: number,
  ): Promise<ConflictCopySummary> {
    const summary = emptyCopySummary();
    try {
      const copies = await this.prisma.memory.findMany({
        where: {
          userId: spec.userId,
          scope: CONFLICT_COPY_SCOPE,
          tags: { has: CONFLICT_COPY_TAG },
          metadata: { path: ['conflict', 'sourceTool'], equals: spec.source },
        },
        select: { id: true, metadata: true },
      });
      if (copies.length === 0) return summary;

      const stillConflicted = new Set(
        (await this.detectConflicts(spec, skewMs)).map((c) => c.memoryId),
      );
      for (const copy of copies) {
        const contestedId = readConflictMeta(copy.metadata)?.memoryId;
        if (
          typeof contestedId !== 'string' ||
          stillConflicted.has(contestedId)
        ) {
          continue;
        }
        // Scope-guarded delete: only rows in the conflict scope can match.
        const deleted = await this.ltm.delete(
          spec.userId,
          copy.id,
          undefined,
          CONFLICT_COPY_SCOPE,
        );
        if (deleted) {
          summary.removedStale++;
          this.logger.log(
            `removed stale conflict copy ${copy.id} (conflict on ${contestedId} resolved)`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `conflict-copy cleanup failed for ${spec.source}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return summary;
  }
}
