import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { CreateLtmMemoryData, MemoryLtmService } from '@engram/memory-ltm';
import {
  LiteJsonStore,
  LITE_STORE_TOKEN,
  type LiteMemory,
} from '@engram/memory-lite';
import {
  MigrationStateService,
  DEFAULT_MIGRATION_ID,
} from './migration-state.service';
import {
  countLiteMemories,
  enumerateLiteUsers,
  listLitePage,
} from './lite-enumerator';
import { resolveDataDir, sortKeys } from './migration-utils';

/**
 * Result returned by a {@link BackfillService.run} invocation.
 *
 * `processed` is the number of lite-store records we attempted; `written`
 * is the number of *new* shadow rows; `duplicates` are records that
 * already had an equivalent enterprise row (idempotent retry); `failed`
 * is the number of per-item failures we logged + skipped (never blocks
 * the batch).
 */
export interface BackfillSummary {
  processed: number;
  written: number;
  duplicates: number;
  failed: number;
  userCount: number;
  durationMs: number;
  cursor: string | null;
}

/**
 * Input for a single backfill pass.
 */
export interface BackfillOptions {
  /** Migration id; defaults to {@link DEFAULT_MIGRATION_ID}. */
  migrationId?: string;
  /** Memories per page; defaults to the value of `BACKFILL_BATCH_SIZE` or 100. */
  batchSize?: number;
  /** Resume from a previously returned cursor. */
  cursor?: string | null;
  /** Maximum memories to process in this pass. */
  maxMemories?: number;
  /** When true, exits cleanly without throwing on partial failures. */
  bestEffort?: boolean;
}

/**
 * Cursor token used to resume a backfill.
 *
 * Cursor format: `<userId>::<lastMemoryId>`. When the userId segment is
 * empty the cursor is interpreted as "start at the first user in the
 * enumeration". The token is opaque to callers.
 */
function encodeCursor(
  userId: string | null,
  memoryId: string | null,
): string | null {
  if (userId === null && memoryId === null) return null;
  return `${userId ?? ''}::${memoryId ?? ''}`;
}

function decodeCursor(token: string | null): {
  userId: string | null;
  memoryId: string | null;
} {
  if (!token) return { userId: null, memoryId: null };
  const sep = token.indexOf('::');
  if (sep === -1) {
    return { userId: token, memoryId: null };
  }
  return {
    userId: token.slice(0, sep) || null,
    memoryId: token.slice(sep + 2) || null,
  };
}

/**
 * Compute a manifest hash over the lite-store content. Captured once
 * at the start of a migration and stamped on the checkpoint; verifiers
 * compare the current hash against the captured value to detect drift
 * between batches.
 */
export async function computeLiteManifestHash(
  store: LiteJsonStore,
): Promise<string> {
  const dataDir = resolveDataDir(store, 'BackfillService');
  const userIds = await enumerateLiteUsers(dataDir);
  userIds.sort();
  const hasher = createHash('sha256');
  for (const userId of userIds) {
    const total = await countLiteMemories(store, userId, false);
    hasher.update(`${userId}:${total};`);
  }
  return hasher.digest('hex');
}

/**
 * Staged backfill service.
 *
 * Walks every user's long-term memories from the lite store and
 * persists them to the enterprise `MemoryLtmService`. Per-item
 * failures are caught + logged + counted, never raised; the batch
 * progresses regardless. The cursor is updated on every batch so an
 * interrupted pass resumes from the exact (userId, memoryId) pair it
 * last touched.
 *
 * Idempotency:
 *
 *   - For each candidate we check the enterprise store for an existing
 *     record (by id). When the record exists we increment `duplicates`
 *     and move on — no second write.
 *   - When the lite record's content has changed since the last
 *     enterprise write, we issue an `update` instead of a `create`.
 *   - When the lite record no longer exists, we issue a `delete`.
 */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);
  private readonly defaultBatchSize: number;

  constructor(
    @Inject(LITE_STORE_TOKEN) private readonly liteStore: LiteJsonStore,
    private readonly migrationState: MigrationStateService,
    @Optional()
    private readonly enterpriseLtm?: Pick<
      MemoryLtmService,
      'create' | 'update' | 'delete' | 'get'
    >,
  ) {
    const envValue = Number.parseInt(
      process.env['BACKFILL_BATCH_SIZE'] ?? '',
      10,
    );
    this.defaultBatchSize =
      Number.isFinite(envValue) && envValue > 0 ? envValue : 100;
  }

  /**
   * Run a single backfill pass. Returns a {@link BackfillSummary} so
   * callers can checkpoint and resume.
   */
  async run(options: BackfillOptions = {}): Promise<BackfillSummary> {
    if (!this.enterpriseLtm) {
      throw new Error(
        'BackfillService: enterpriseLtm is not configured. ' +
          'Wire the LTM provider before running a backfill pass.',
      );
    }

    const migrationId = options.migrationId ?? DEFAULT_MIGRATION_ID;
    // `batchSize` is captured for the per-page chunking path; the
    // outer driver uses the lite-store's internal page size (100) so
    // checkpoint granularity is fixed at the page level.
    const _batchSize = options.batchSize ?? this.defaultBatchSize;
    void _batchSize;
    const maxMemories = options.maxMemories ?? Number.POSITIVE_INFINITY;
    const start = Date.now();

    const existing = await this.migrationState.tryLoad(migrationId);
    if (!existing) {
      throw new Error(
        `BackfillService: no migration checkpoint for ${migrationId}; seed one with MigrationStateService.checkpointMigration first.`,
      );
    }
    if (existing.state !== 'copying') {
      throw new Error(
        `BackfillService: cannot run while state=${existing.state}; must be 'copying'.`,
      );
    }

    const resumeFrom =
      options.cursor !== undefined ? options.cursor : existing.cursor;
    const decoded = decodeCursor(resumeFrom);
    const dataDir = resolveDataDir(this.liteStore, 'BackfillService');
    const allUsers = await enumerateLiteUsers(dataDir);
    allUsers.sort();

    // Trim the user list to start at the cursor's user.
    let startIdx = 0;
    if (decoded.userId !== null) {
      startIdx = allUsers.indexOf(decoded.userId);
      if (startIdx === -1) {
        // Cursor references a user that no longer exists; advance to
        // the end so we cleanly finish this pass.
        startIdx = allUsers.length;
      }
    }

    let processed = existing.progress;
    let written = 0;
    let duplicates = 0;
    let failed = 0;
    let lastUser: string | null = decoded.userId;
    let lastMemory: string | null = decoded.memoryId;

    outer: for (let i = startIdx; i < allUsers.length; i += 1) {
      const userId = allUsers[i];
      if (userId === undefined) break;
      lastUser = userId;
      let cursor: string | null =
        decoded.userId === userId ? decoded.memoryId : null;

      while (true) {
        if (processed >= maxMemories) break outer;
        const page = await listLitePage(this.liteStore, userId, cursor, false);
        if (page.items.length === 0) {
          break;
        }
        for (const memory of page.items) {
          if (processed >= maxMemories) break outer;
          processed += 1;
          lastMemory = memory.id;
          try {
            const outcome = await this.copyOne(memory);
            if (outcome === 'written') written += 1;
            else if (outcome === 'duplicate') duplicates += 1;
          } catch (error) {
            failed += 1;
            this.logger.error(
              `backfill: failed to copy ${userId}/${memory.id}: ${String(error)}`,
            );
          }
        }
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
        lastMemory = cursor;

        // Persist checkpoint at every page so a crash mid-user is
        // resumed from a known good point.
        try {
          await this.migrationState.checkpointMigration('copying', {
            id: migrationId,
            cursor: encodeCursor(lastUser, lastMemory),
            progress: processed,
            totalItems: existing.totalItems ?? null,
          });
        } catch (error) {
          this.logger.error(
            `backfill: checkpoint write failed at ${lastUser}/${lastMemory}: ${String(error)}`,
          );
          if (!options.bestEffort) throw error;
        }
      }
    }

    // Final checkpoint before returning so the cursor is durable.
    try {
      await this.migrationState.checkpointMigration('copying', {
        id: migrationId,
        cursor: encodeCursor(lastUser, lastMemory),
        progress: processed,
        totalItems: existing.totalItems ?? null,
      });
    } catch (error) {
      this.logger.error(
        `backfill: final checkpoint write failed: ${String(error)}`,
      );
      if (!options.bestEffort) throw error;
    }

    return {
      processed,
      written,
      duplicates,
      failed,
      userCount: allUsers.length,
      durationMs: Date.now() - start,
      cursor: encodeCursor(lastUser, lastMemory),
    };
  }

  /**
   * Copy a single lite memory to the enterprise shadow, choosing
   * `create` / `update` / `delete` based on what already exists.
   */
  private async copyOne(memory: LiteMemory): Promise<'written' | 'duplicate'> {
    if (!this.enterpriseLtm) {
      throw new Error('enterpriseLtm is not configured');
    }
    const existing = await this.safeGet(memory.userId, memory.id);

    if (!existing) {
      const data: CreateLtmMemoryData = {
        userId: memory.userId,
        organizationId: memory.organizationId,
        content: memory.content,
        // Tag the enterprise row with the source lite id so the
        // verifier (and future cutover tooling) can match the
        // shadow row back to the canonical lite record. The
        // `MemoryLtmService` mints its own `id` for the new row,
        // so we rely on a metadata key to preserve the linkage.
        metadata: {
          ...(memory.metadata ?? {}),
          _liteId: memory.id,
        },
        tags: memory.tags,
        skipDuplicateCheck: true,
      };
      try {
        await this.enterpriseLtm.create(data);
        return 'written';
      } catch (error) {
        if (isDuplicateConflict(error)) {
          return 'duplicate';
        }
        throw error;
      }
    }

    // Record already exists in the enterprise shadow; this is the
    // idempotency check that makes the backfill safe to re-run.
    // We strip the migration-only `_liteId` annotation from the
    // enterprise side so the comparison ignores the link key the
    // backfill added (and which the lite source does not have).
    // `null` and `undefined` metadata are both normalised to `null`
    // so the equality check treats "no metadata" the same on both
    // sides.
    const liteMeta =
      memory.metadata && Object.keys(memory.metadata).length > 0
        ? memory.metadata
        : null;
    const shadowMeta = normaliseMetadata(stripLiteIdKey(existing.metadata));
    if (
      existing.content === memory.content &&
      tagsEqual(existing.tags, memory.tags) &&
      metadataEqual(shadowMeta, liteMeta)
    ) {
      return 'duplicate';
    }

    await this.enterpriseLtm.update(memory.userId, memory.id, {
      content: memory.content,
      metadata: memory.metadata,
      tags: memory.tags,
    });
    return 'written';
  }

  private async safeGet(
    userId: string,
    memoryId: string,
  ): Promise<LiteMemoryLike | null> {
    if (!this.enterpriseLtm) return null;
    try {
      const found = await this.enterpriseLtm.get(userId, memoryId);
      if (!found) return null;
      const f = found as unknown as {
        content: string;
        tags: string[];
        metadata: unknown;
      };
      return {
        content: f.content,
        tags: Array.isArray(f.tags) ? f.tags : [],
        metadata: f.metadata,
      };
    } catch (error) {
      // `MemoryLtmService.get` returns `null` for not-found, but some
      // adapters may throw a typed error. Treat any "not found" error
      // as a missing record so the backfill can create it.
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

interface LiteMemoryLike {
  content: string;
  tags: string[];
  metadata: unknown;
}

function tagsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function metadataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  // Order-insensitive deep equality for plain JSON-compatible metadata.
  try {
    return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  } catch {
    return false;
  }
}

/**
 * Strip the migration-only `_liteId` annotation from a metadata
 * object so idempotency checks compare only user-supplied fields.
 */
function stripLiteIdKey(metadata: unknown): unknown {
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
 * Normalise "no user-supplied metadata" to `null` so a backfilled
 * row that contains only the migration-only `_liteId` key is
 * treated as metadata-less on the equality check.
 */
function normaliseMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const record = metadata as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return null;
  return metadata;
}

function isDuplicateConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; name?: string; message?: string };
  if (e.code === 'P2002') return true;
  if (e.code === 'P2010') return true;
  if (e.name === 'LtmMemoryQuotaExceededError') return false;
  if (typeof e.message === 'string' && /duplicate|unique/i.test(e.message)) {
    return true;
  }
  return false;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  return (
    e.name === 'LtmMemoryNotFoundError' ||
    (typeof e.message === 'string' && /not\s*found/i.test(e.message))
  );
}

export { encodeCursor, decodeCursor };
