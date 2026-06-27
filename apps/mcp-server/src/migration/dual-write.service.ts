import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { MemoryLtmService } from '@engram/memory-ltm';
import {
  LiteJsonStore,
  LITE_STORE_TOKEN,
  type LiteMemory,
} from '@engram/memory-lite';
import type {
  CreateLtmMemoryData,
  UpdateLtmMemoryData,
} from '@engram/memory-ltm';
import {
  MigrationStateService,
  DEFAULT_MIGRATION_ID,
} from './migration-state.service';

/**
 * Input shape accepted by {@link DualWriteCoordinator.create}.
 *
 * Mirrors {@link CreateLtmMemoryData} so callers can hand a single DTO
 * to both stores; `contentHash` is computed when absent so we don't
 * always pay the hash cost on the call path.
 */
export interface DualWriteCreateInput {
  userId: string;
  organizationId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  contentHash?: string;
  skipDuplicateCheck?: boolean;
}

/**
 * Input shape accepted by {@link DualWriteCoordinator.update}.
 */
export interface DualWriteUpdateInput {
  content?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  contentHash?: string;
}

/**
 * Outcome of a dual-write operation.
 *
 * `primary` is the result returned to the caller (always the lite
 * store's record so reads keep hitting the source of truth during the
 * `copying`/`verifying` window). `shadow` is `null` when the target
 * write succeeded or was intentionally skipped; carries a duplicate
 * annotation when the shadow already had an equivalent record.
 */
export interface DualWriteResult {
  primary: LiteMemory;
  shadowWritten: boolean;
  shadowDuplicate: boolean;
  /** Hash used for deduplication; exposed for log/audit clarity. */
  contentHash: string;
  /** Number of retry attempts consumed by the shadow write (0 when first try succeeded). */
  retryCount: number;
}

/**
 * Mapping of memory id → content hash for shadow-store deduplication.
 *
 * Memory-lite does not have a per-record uniqueness constraint
 * (semantic dedup is performed by `DuplicateDetectionService` upstream)
 * so we keep an in-memory map of `memoryId -> contentHash` so that
 * re-runs of the same dual-write (e.g. after retry, after chaos
 * recovery) do not double-write to the enterprise shadow.
 *
 * The map is intentionally process-local: the durable record of what
 * was already written lives in the enterprise store itself (the
 * `Memory` row); the map is just a fast path to avoid an extra round
 * trip for the common case.
 */
type ContentHashIndex = Map<string, string>;

/**
 * Computes the SHA-256 content hash used for cross-store dedup.
 *
 * Includes the stable userId so the same content under different
 * tenants does not collide. Exported for test reuse.
 */
export function computeContentHash(userId: string, content: string): string {
  return createHash('sha256').update(`${userId}\n${content}`).digest('hex');
}

/**
 * Dual-write coordinator.
 *
 * When {@link MigrationStateService.currentState} is `copying` or
 * `verifying`, writes received by `create`/`update`/`delete` are
 * fanned out to:
 *
 *   1. The profile-lite `LiteJsonStore` (source of truth during the
 *      `copying` window; reads still hit this store).
 *   2. The profile-enterprise `MemoryLtmService` (target shadow; populated
 *      so the backfill service can pick up where dual-write left off
 *      and the verifier can spot-check integrity).
 *
 * Writes outside the dual-write window (`idle`, `preparing`,
 * `cutting_over`, `complete`, `rollback`) are passed straight through
 * to the lite store — the enterprise store is not touched until the
 * `copying` window opens.
 *
 * Failure semantics:
 *
 *   - Primary write succeeds, shadow fails: log + retry up to
 *     `SHADOW_MAX_ATTEMPTS` times with exponential backoff. After the
 *     budget is exhausted the record is recorded in the per-instance
 *     `pendingShadowWrites` set so the next backfill pass can mop up.
 *     The primary write is **never** blocked by a shadow failure.
 *   - Duplicate detected in the shadow (memory id + content hash
 *     already present): skip + log, treat as success.
 *   - Primary write fails: propagate the original error; the caller
 *     sees a normal failure and we never end up with a shadow-only
 *     record.
 */
@Injectable()
export class DualWriteCoordinator implements OnModuleDestroy {
  private readonly logger = new Logger(DualWriteCoordinator.name);
  private readonly shadowIndex: ContentHashIndex = new Map();
  private readonly pendingShadowWrites = new Set<string>();
  /** Set when {@link setShuttingDown} is called; disables new shadow writes. */
  private shuttingDown = false;

  /** Maximum number of attempts for a single shadow write before giving up. */
  static readonly SHADOW_MAX_ATTEMPTS = 3;
  /** Base delay (ms) for exponential backoff between shadow retries. */
  static readonly SHADOW_RETRY_BASE_MS = 50;

  constructor(
    @Inject(LITE_STORE_TOKEN) private readonly liteStore: LiteJsonStore,
    private readonly migrationState: MigrationStateService,
    @Optional()
    private readonly enterpriseLtm?: Pick<
      MemoryLtmService,
      'create' | 'update' | 'delete' | 'get'
    >,
  ) {}

  /**
   * Test/CLI hook: mark the coordinator as shutting down so the next
   * write skips the shadow leg. Used by chaos tests to simulate a
   * process exit without leaking pending shadow writes.
   */
  setShuttingDown(value: boolean): void {
    this.shuttingDown = value;
  }

  async onModuleDestroy(): Promise<void> {
    this.setShuttingDown(true);
    // Drain any pending shadow writes so we don't leak retry budget
    // across hot reloads during local development.
    this.pendingShadowWrites.clear();
    await Promise.resolve();
  }

  /**
   * Dual-write create.
   *
   * Returns the lite store's record (the canonical source during the
   * `copying` window). The `contentHash` field of the result is the
   * hash that was used for shadow deduplication; pass it back to
   * {@link update} when you change the content.
   */
  async create(input: DualWriteCreateInput): Promise<DualWriteResult> {
    const hash =
      input.contentHash ?? computeContentHash(input.userId, input.content);
    const primary = await this.liteStore.create({
      userId: input.userId,
      organizationId: input.organizationId,
      content: input.content,
      metadata: input.metadata,
      tags: input.tags,
      type: 'long-term',
    });

    const state = await this.migrationState.currentState();
    if (!shouldDualWrite(state)) {
      return {
        primary,
        shadowWritten: false,
        shadowDuplicate: false,
        contentHash: hash,
        retryCount: 0,
      };
    }

    const shadow = await this.writeShadowCreate(primary, hash, input);
    return {
      primary,
      shadowWritten: shadow.written,
      shadowDuplicate: shadow.duplicate,
      contentHash: hash,
      retryCount: shadow.retryCount,
    };
  }

  /**
   * Dual-write update.
   *
   * Always updates the lite store first; only writes to the shadow
   * when the migration state is `copying` or `verifying`.
   *
   * Note: the in-process shadow index is **not** pre-populated here.
   * {@link writeShadowUpdate} reads the previous hash from the index
   * to decide whether the shadow already reflects the new content
   * (duplicate) or needs an `update` call. Pre-populating the index
   * would mask legitimate updates and force the dedupe path.
   */
  async update(
    userId: string,
    memoryId: string,
    patch: DualWriteUpdateInput,
  ): Promise<DualWriteResult | null> {
    const updated = await this.liteStore.update(userId, memoryId, {
      content: patch.content,
      metadata: patch.metadata,
      tags: patch.tags,
    });

    const hash =
      patch.contentHash ?? computeContentHash(userId, updated.content);
    const state = await this.migrationState.currentState();
    if (!shouldDualWrite(state)) {
      return {
        primary: updated,
        shadowWritten: false,
        shadowDuplicate: false,
        contentHash: hash,
        retryCount: 0,
      };
    }

    const shadow = await this.writeShadowUpdate(updated, hash, patch);
    return {
      primary: updated,
      shadowWritten: shadow.written,
      shadowDuplicate: shadow.duplicate,
      contentHash: hash,
      retryCount: shadow.retryCount,
    };
  }

  /**
   * Dual-write delete.
   *
   * Deletes from the lite store first; the shadow delete follows when
   * the migration state is `copying` or `verifying`. Returns `true`
   * when the primary was deleted.
   */
  async delete(userId: string, memoryId: string): Promise<boolean> {
    const removed = await this.liteStore.delete(userId, memoryId);
    this.shadowIndex.delete(memoryId);
    this.pendingShadowWrites.delete(memoryId);

    if (!removed) {
      return false;
    }

    const state = await this.migrationState.currentState();
    if (!shouldDualWrite(state) || this.shuttingDown) {
      return true;
    }

    if (!this.enterpriseLtm) {
      return true;
    }

    await this.retry(memoryId, `delete:${memoryId}`, async () => {
      await this.enterpriseLtm!.delete(userId, memoryId);
    });
    return true;
  }

  /**
   * Mark a memory as already dual-written, used by the backfill service
   * when it has just persisted a record directly to the enterprise
   * store. Prevents the next create call from double-writing.
   */
  registerShadowHash(memoryId: string, contentHash: string): void {
    this.shadowIndex.set(memoryId, contentHash);
  }

  /**
   * Snapshot the in-process shadow index. Exposed for tests so they
   * can assert on dedupe behaviour without reaching into private state.
   */
  snapshotShadowIndex(): Record<string, string> {
    return Object.fromEntries(this.shadowIndex.entries());
  }

  /**
   * Return the set of memory ids whose shadow write was abandoned
   * (after retry exhaustion). The backfill service drains this set on
   * its next pass.
   */
  drainPendingShadowWrites(): string[] {
    const ids = Array.from(this.pendingShadowWrites);
    this.pendingShadowWrites.clear();
    return ids;
  }

  // ────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────────────

  private async writeShadowCreate(
    primary: LiteMemory,
    hash: string,
    input: DualWriteCreateInput,
  ): Promise<{ written: boolean; duplicate: boolean; retryCount: number }> {
    if (this.shuttingDown || !this.enterpriseLtm) {
      this.pendingShadowWrites.add(primary.id);
      return { written: false, duplicate: false, retryCount: 0 };
    }

    const existingHash = this.shadowIndex.get(primary.id);
    if (existingHash === hash) {
      return { written: false, duplicate: true, retryCount: 0 };
    }

    const ltmInput: CreateLtmMemoryData = {
      userId: primary.userId,
      organizationId: primary.organizationId,
      content: primary.content,
      // Tag the enterprise row with the source lite id so the
      // verifier can match the shadow row back to the canonical
      // lite record. The `MemoryLtmService` mints its own `id`
      // for the new row, so we rely on a metadata key to preserve
      // the linkage.
      metadata: {
        ...(primary.metadata ?? {}),
        _liteId: primary.id,
      },
      tags: primary.tags,
      skipDuplicateCheck: input.skipDuplicateCheck ?? true,
    };

    return this.runShadowWrite(primary.id, hash, () =>
      this.enterpriseLtm!.create(ltmInput),
    );
  }

  private async writeShadowUpdate(
    primary: LiteMemory,
    hash: string,
    patch: DualWriteUpdateInput,
  ): Promise<{ written: boolean; duplicate: boolean; retryCount: number }> {
    if (this.shuttingDown || !this.enterpriseLtm) {
      this.pendingShadowWrites.add(primary.id);
      return { written: false, duplicate: false, retryCount: 0 };
    }

    const existingHash = this.shadowIndex.get(primary.id);
    if (existingHash === hash && existingHash !== undefined) {
      // Shadow already reflects this content; nothing to do.
      return { written: false, duplicate: true, retryCount: 0 };
    }

    const updateInput: UpdateLtmMemoryData = {
      content: patch.content ?? primary.content,
      metadata: patch.metadata ?? primary.metadata,
      tags: patch.tags ?? primary.tags,
    };

    return this.runShadowWrite(primary.id, hash, async () => {
      // `update` may legitimately return the existing record when
      // content is unchanged; either way the shadow ends up in sync.
      await this.enterpriseLtm!.update(primary.userId, primary.id, updateInput);
    });
  }

  private async runShadowWrite(
    memoryId: string,
    hash: string,
    op: () => Promise<unknown>,
  ): Promise<{ written: boolean; duplicate: boolean; retryCount: number }> {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt < DualWriteCoordinator.SHADOW_MAX_ATTEMPTS) {
      try {
        await op();
        this.shadowIndex.set(memoryId, hash);
        this.pendingShadowWrites.delete(memoryId);
        return {
          written: true,
          duplicate: false,
          retryCount: attempt,
        };
      } catch (error) {
        lastError = error;
        attempt += 1;
        // If the underlying service reports a duplicate-key conflict,
        // treat it as success — the shadow already has an equivalent
        // record. This is how MemoryLtmService surfaces unique-index
        // collisions.
        if (isDuplicateConflict(error)) {
          this.shadowIndex.set(memoryId, hash);
          this.pendingShadowWrites.delete(memoryId);
          return {
            written: false,
            duplicate: true,
            retryCount: attempt,
          };
        }
        if (attempt < DualWriteCoordinator.SHADOW_MAX_ATTEMPTS) {
          await sleep(
            DualWriteCoordinator.SHADOW_RETRY_BASE_MS * 2 ** (attempt - 1),
          );
        }
      }
    }
    this.pendingShadowWrites.add(memoryId);
    this.logger.error(
      `dual-write shadow create/update failed for ${memoryId} after ${attempt} attempts: ${String(lastError)}`,
    );
    return {
      written: false,
      duplicate: false,
      retryCount: attempt,
    };
  }

  private async retry(
    memoryId: string,
    label: string,
    op: () => Promise<void>,
  ): Promise<void> {
    let attempt = 0;
    while (attempt < DualWriteCoordinator.SHADOW_MAX_ATTEMPTS) {
      try {
        await op();
        return;
      } catch (error) {
        attempt += 1;
        if (attempt >= DualWriteCoordinator.SHADOW_MAX_ATTEMPTS) {
          // Record for the next backfill pass, matching runShadowWrite semantics.
          this.pendingShadowWrites.add(memoryId);
          this.logger.error(
            `dual-write ${label} failed after ${attempt} attempts: ${String(error)}`,
          );
          return;
        }
        await sleep(
          DualWriteCoordinator.SHADOW_RETRY_BASE_MS * 2 ** (attempt - 1),
        );
      }
    }
  }
}

/**
 * Dual-write window. The coordinator only fans out to the enterprise
 * shadow while the migration is in `copying` or `verifying`. Earlier
 * states (`idle`, `preparing`) have no target to write to; later
 * states (`cutting_over`, `complete`, `rollback`) either expect the
 * backfill to have done the work already (`cutting_over`/`complete`)
 * or have rolled back so writes must stop (`rollback`).
 */
function shouldDualWrite(state: string | null): boolean {
  return state === 'copying' || state === 'verifying';
}

/**
 * Detect a Prisma-style unique-constraint violation. We match on error
 * shape rather than importing Prisma types so this module stays
 * decoupled from `@prisma/client`.
 */
function isDuplicateConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e.code !== 'P2002' && e.code !== 'P2010') return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Re-export the default id so callers don't need a separate import. */
export { DEFAULT_MIGRATION_ID };
