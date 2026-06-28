import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { MemoryLtmService } from '@engram/memory-ltm';
import { LiteJsonStore, LITE_STORE_TOKEN } from '@engram/memory-lite';
import {
  MigrationStateService,
  DEFAULT_MIGRATION_ID,
} from './migration-state.service';
import { countLiteMemories, enumerateLiteUsers } from './lite-enumerator';
import { resolveDataDir, sortKeys } from './migration-utils';

/**
 * Hard-stop threshold (fraction). When the mismatch ratio exceeds this
 * value the verifier aborts the migration rather than progressing to
 * `cutting_over`. Matches the plan's "0.001%" integrity budget.
 */
export const DEFAULT_HARD_STOP_FRACTION = 0.00001;

/**
 * Output of a {@link VerifierService.verify} pass.
 *
 * `passed` is `true` when every per-user count matches **and** the
 * hash mismatch ratio is within the hard-stop fraction. When `passed`
 * is `false`, callers should consult `abortReason` to decide whether
 * to roll back.
 */
export interface VerifierReport {
  passed: boolean;
  hardStopFraction: number;
  globalMismatchRatio: number;
  globalSourceCount: number;
  globalTargetCount: number;
  globalHashMatchCount: number;
  globalHashMismatchCount: number;
  perUser: VerifierUserReport[];
  abortReason: string | null;
  reportPath: string | null;
  generatedAt: string;
}

export interface VerifierUserReport {
  userId: string;
  sourceCount: number;
  targetCount: number;
  hashMatch: number;
  hashMismatch: number;
  /** Per-user mismatch ratio (`hashMismatch / sourceCount`); `0` when `sourceCount` is `0`. */
  mismatchRatio: number;
}

export interface VerifierOptions {
  migrationId?: string;
  /** Hard-stop threshold (fraction). Defaults to {@link DEFAULT_HARD_STOP_FRACTION}. */
  hardStopFraction?: number;
  /** When set, the JSON report is written to this path. */
  reportPath?: string;
  /**
   * When `true`, automatically transitions the migration to `rollback`
   * when the report fails. Defaults to `true` so a failed verify never
   * silently advances to cutover.
   */
  abortOnFailure?: boolean;
}

/** Minimal slice of `MemoryLtmService` the verifier depends on. */
type EnterpriseLtmSlice = Pick<MemoryLtmService, 'list' | 'get'>;

interface TargetMemoryLite {
  id: string;
  content: string;
  metadata: unknown;
  tags: string[];
}

/**
 * Migration verifier.
 *
 * Compares the profile-lite store against the enterprise shadow:
 *
 *   1. Per-user counts must match exactly.
 *   2. SHA-256 content hash per `(userId, memoryId)` must match.
 *   3. Hard-stops when global mismatch ratio exceeds
 *      {@link DEFAULT_HARD_STOP_FRACTION}.
 *
 * On success the verifier transitions the migration `verifying` →
 * `cutting_over` (caller is responsible for the final
 * `completeMigration()` once the cutover window closes).
 *
 * On hard-stop the verifier transitions the migration to `rollback`
 * (unless `abortOnFailure: false`) and writes a JSON report alongside
 * the result so operators can inspect the per-user mismatch.
 */
@Injectable()
export class VerifierService {
  private readonly logger = new Logger(VerifierService.name);

  constructor(
    @Inject(LITE_STORE_TOKEN) private readonly liteStore: LiteJsonStore,
    private readonly migrationState: MigrationStateService,
    @Optional()
    private readonly enterpriseLtm?: EnterpriseLtmSlice,
  ) {}

  async verify(options: VerifierOptions = {}): Promise<VerifierReport> {
    const migrationId = options.migrationId ?? DEFAULT_MIGRATION_ID;
    const hardStop = options.hardStopFraction ?? DEFAULT_HARD_STOP_FRACTION;
    const abortOnFailure = options.abortOnFailure ?? true;

    const checkpoint = await this.migrationState.tryLoad(migrationId);
    if (!checkpoint) {
      throw new Error(
        `VerifierService: no migration checkpoint for ${migrationId}; cannot verify.`,
      );
    }
    if (checkpoint.state !== 'verifying' && checkpoint.state !== 'copying') {
      throw new Error(
        `VerifierService: cannot verify while state=${checkpoint.state}; must be 'verifying' or 'copying'.`,
      );
    }

    // Move to verifying if we're still in copying.
    if (checkpoint.state === 'copying') {
      await this.migrationState.checkpointMigration('verifying', {
        id: migrationId,
        cursor: checkpoint.cursor,
        progress: checkpoint.progress,
        totalItems: checkpoint.totalItems,
        sourceManifestHash: checkpoint.sourceManifestHash,
      });
    }

    const report = await this.runComparison(
      migrationId,
      hardStop,
      options.reportPath,
    );

    if (report.passed) {
      await this.migrationState.checkpointMigration('cutting_over', {
        id: migrationId,
        cursor: null,
        progress: checkpoint.progress,
        totalItems: checkpoint.totalItems,
        sourceManifestHash: checkpoint.sourceManifestHash,
      });
    } else if (abortOnFailure) {
      await this.migrationState.abortMigration(
        migrationId,
        report.abortReason ?? 'integrity hard-stop',
      );
    }

    return report;
  }

  private async runComparison(
    migrationId: string,
    hardStop: number,
    reportPath: string | undefined,
  ): Promise<VerifierReport> {
    const dataDir = resolveDataDir(this.liteStore, 'VerifierService');
    const users = await enumerateLiteUsers(dataDir);
    users.sort();

    const perUser: VerifierUserReport[] = [];
    let sourceTotal = 0;
    let targetTotal = 0;
    let hashMatch = 0;
    let hashMismatch = 0;

    for (const userId of users) {
      const sourceCount = await countLiteMemories(
        this.liteStore,
        userId,
        false,
      );
      const targetIds = await this.safeListTargetIds(userId);
      const targetCount = targetIds.length;
      sourceTotal += sourceCount;
      targetTotal += targetCount;

      // Build a liteId -> enterprise row index for this user. The
      // backfill tags each shadow row with `_liteId` metadata so
      // the verifier can match the lite source to its enterprise
      // counterpart without relying on the row's primary id.
      const targetByLiteId = new Map<string, TargetMemoryLite>();
      for (const id of targetIds) {
        const row = await this.safeGetTarget(userId, id);
        if (!row) continue;
        const liteId = readLiteId(row);
        if (typeof liteId === 'string' && liteId.length > 0) {
          targetByLiteId.set(liteId, row);
        }
      }

      // Walk the lite store and compare hashes; we use the index cursor
      // to avoid scanning the full disk twice.
      let userMatch = 0;
      let userMismatch = 0;
      let cursor: string | null = null;
      while (true) {
        const page = await this.liteStore.list(userId, {
          cursor: cursor ?? undefined,
          limit: 100,
          includeShortTerm: false,
        });
        for (const memory of page.items) {
          const liteHash = hashMemory({
            content: memory.content,
            metadata: normaliseMetadataForHash(memory.metadata),
            tags: memory.tags,
          });
          const target = targetByLiteId.get(memory.id);
          if (!target) {
            userMismatch += 1;
            continue;
          }
          const targetHash = hashMemory({
            content: target.content,
            metadata: normaliseMetadataForHash(
              stripLiteIdMetadata(target.metadata),
            ),
            tags: target.tags,
          });
          if (targetHash === liteHash) {
            userMatch += 1;
          } else {
            userMismatch += 1;
          }
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      hashMatch += userMatch;
      hashMismatch += userMismatch;
      const mismatchRatio =
        sourceCount === 0
          ? targetCount === 0
            ? 0
            : 1
          : userMismatch / sourceCount;

      perUser.push({
        userId,
        sourceCount,
        targetCount,
        hashMatch: userMatch,
        hashMismatch: userMismatch,
        mismatchRatio,
      });

      this.logger.log(
        `verifier: user=${userId} source=${sourceCount} target=${targetCount} match=${userMatch} mismatch=${userMismatch}`,
      );
    }

    const globalDenominator = Math.max(sourceTotal, 1);
    const globalMismatchRatio = hashMismatch / globalDenominator;
    const passed =
      globalMismatchRatio <= hardStop &&
      hashMismatch === 0 &&
      sourceTotal === targetTotal;
    const abortReason = passed
      ? null
      : `integrity mismatch ratio=${globalMismatchRatio.toFixed(6)} exceeds hard-stop=${hardStop} (mismatches=${hashMismatch})`;

    const generated: Omit<VerifierReport, 'reportPath'> = {
      passed,
      hardStopFraction: hardStop,
      globalMismatchRatio,
      globalSourceCount: sourceTotal,
      globalTargetCount: targetTotal,
      globalHashMatchCount: hashMatch,
      globalHashMismatchCount: hashMismatch,
      perUser,
      abortReason,
      generatedAt: new Date().toISOString(),
    };

    let finalReportPath: string | null = null;
    if (reportPath) {
      await mkdir(path.dirname(reportPath), { recursive: true });
      const full = { ...generated, migrationId };
      await writeFile(reportPath, JSON.stringify(full, null, 2), {
        encoding: 'utf8',
      });
      finalReportPath = reportPath;
    }

    return { ...generated, reportPath: finalReportPath };
  }

  private async safeListTargetIds(userId: string): Promise<string[]> {
    if (!this.enterpriseLtm) return [];
    try {
      const ids: string[] = [];
      let cursor: string | undefined;
      while (true) {
        const page = (await this.enterpriseLtm.list(userId, {
          limit: 100,
          cursor,
        })) as unknown;
        const result = page as {
          items?: TargetMemoryLite[];
          hasNextPage?: boolean;
          endCursor?: string;
        };
        const items = Array.isArray(page)
          ? (page as TargetMemoryLite[])
          : (result.items ?? []);
        for (const memory of items) {
          ids.push((memory as TargetMemoryLite & { id: string }).id);
        }
        if (!result.hasNextPage || !result.endCursor) break;
        cursor = result.endCursor;
      }
      return ids;
    } catch (error) {
      this.logger.error(
        `verifier: failed to list target ids for ${userId}: ${String(error)}`,
      );
      return [];
    }
  }

  private async safeGetTarget(
    userId: string,
    memoryId: string,
  ): Promise<TargetMemoryLite | null> {
    if (!this.enterpriseLtm) return null;
    try {
      const ltm = this.enterpriseLtm as unknown as {
        get: (u: string, id: string) => Promise<TargetMemoryLite | null>;
      };
      const found = await ltm.get(userId, memoryId);
      return found ?? null;
    } catch {
      return null;
    }
  }
}

/** Read the `_liteId` annotation off an enterprise shadow row. */
function readLiteId(row: TargetMemoryLite): string | null {
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)['_liteId'];
  return typeof value === 'string' ? value : null;
}

/** Strip the migration-only `_liteId` annotation so hash comparison ignores it. */
function stripLiteIdMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const record = metadata as Record<string, unknown>;
  if (!('_liteId' in record)) return metadata;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === '_liteId') continue;
    next[key] = value;
  }
  return next;
}

/**
 * Normalise "no metadata" to `{}` (or to the supplied object) so the
 * hash comparison treats the lite source and the stripped enterprise
 * shadow consistently when the user did not supply any metadata.
 */
function normaliseMetadataForHash(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {};
  if (Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

function hashMemory(memory: {
  content: string;
  metadata: unknown;
  tags: string[];
}): string {
  const hasher = createHash('sha256');
  hasher.update(memory.content);
  hasher.update('\u0000');
  hasher.update(JSON.stringify(sortKeys(memory.metadata ?? null)));
  hasher.update('\u0000');
  hasher.update([...memory.tags].sort().join('|'));
  return hasher.digest('hex');
}

export { hashMemory };
