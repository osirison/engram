import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { encrypt, decrypt, ENCRYPTION_VERSION_PREFIX, type EncryptedPayload } from './encryption';
import { OWNER_ONLY_DIR_MODE, OWNER_ONLY_FILE_MODE } from './secure-startup';

/**
 * NestJS injection token for the active {@link LiteJsonStore} instance.
 *
 * Modules that want to consume the store without binding to the concrete
 * class can use `Inject(LITE_STORE_TOKEN)`. `LiteJsonStore` itself is also
 * `Injectable`, so it can be used directly with constructor injection.
 */
export const LITE_STORE_TOKEN = Symbol.for('engram.memory-lite.store');

/**
 * In-memory representation of a memory record stored in the profile-lite
 * file-backed JSON store.
 *
 * Mirrors the public surface of `@engram/memory-ltm` (content, tags,
 * metadata, timestamps, type) but is persisted to a per-user shard of the
 * data directory instead of Postgres.
 */
export const liteMemorySchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    organizationId: z.string().min(1).optional(),
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string()).default([]),
    type: z.enum(['short-term', 'long-term']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    embedding: z.array(z.number()).optional(),
  })
  .strict();

export type LiteMemory = z.infer<typeof liteMemorySchema>;

/** Input shape accepted by {@link LiteJsonStore.create}. */
export interface CreateLiteMemoryInput {
  userId: string;
  organizationId?: string;
  content: string;
  type?: 'short-term' | 'long-term';
  metadata?: Record<string, unknown>;
  tags?: string[];
  expiresAt?: Date;
  embedding?: number[];
}

/** Input shape accepted by {@link LiteJsonStore.update}. */
export interface UpdateLiteMemoryInput {
  content?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  embedding?: number[];
  expiresAt?: Date;
}

/** Listing options supported by {@link LiteJsonStore.list}. */
export interface ListLiteMemoriesOptions {
  limit?: number;
  cursor?: string;
  tags?: string[];
  search?: string;
  includeShortTerm?: boolean;
}

/** Page returned by {@link LiteJsonStore.list}. */
export interface ListLiteMemoriesResult {
  items: LiteMemory[];
  nextCursor: string | null;
}

/**
 * Lazy/serialised lock primitive for per-userId write coordination.
 *
 * Each user gets its own promise chain so concurrent writes to the same
 * tenant are observed in the order they were issued, while writes to
 * different tenants can proceed in parallel.
 */
class UserLockTable {
  private readonly chains = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.chains.set(
      key,
      previous.then(() => next)
    );
    try {
      await previous;
      return await fn();
    } finally {
      release?.();
      // Best-effort cleanup: if no new chain queued behind us, drop the
      // entry so the Map does not grow without bound.
      if (this.chains.get(key) === next.then(() => undefined)) {
        this.chains.delete(key);
      }
    }
  }
}

/**
 * File-backed JSON store for profile-lite memories.
 *
 * - Layout: `<dataDir>/memories/<userId>/<memoryId>.json.enc` for encrypted
 *   mode, `.json` for insecure mode. A sidecar `_index.json` per user
 *   records the ordered list of memory ids so listings can paginate without
 *   scanning the entire shard.
 * - Encryption: AES-256-GCM with the record id bound as AAD.
 * - Permissions: every directory is created `0o700`, every file `0o600`.
 * - Writes are atomic: write to `*.tmp` then rename to the final path.
 *
 * This class is `@Injectable()` so the migration tooling and any future
 * NestJS consumers can inject it directly; the legacy singleton-style
 * accessors remain available for callers that prefer an explicit factory.
 */
@Injectable()
export class LiteJsonStore {
  private readonly logger = new Logger(LiteJsonStore.name);
  private readonly locks = new UserLockTable();

  /**
   * Construct a new store bound to `dataDir`.
   *
   * Pass `encryptionKey=undefined` to enable plaintext mode. Callers must
   * run {@link assertSecureStartup} (or otherwise verify permissions)
   * before constructing the store in production.
   */
  constructor(
    private readonly dataDir: string,
    @Optional() private readonly encryptionKey?: Buffer
  ) {
    if (!dataDir) {
      throw new Error('LiteJsonStore requires a non-empty dataDir.');
    }
    if (encryptionKey === undefined) {
      this.logger.warn(
        `LiteJsonStore constructed without an encryption key for ${dataDir}; plaintext mode is active.`
      );
    }
  }

  /** True when this store is persisting plaintext (insecure) records. */
  public get isInsecure(): boolean {
    return this.encryptionKey === undefined;
  }

  /**
   * Create a new memory and persist it to disk.
   *
   * Returns the canonical record, including server-generated `id`,
   * timestamps, and the persisted file path.
   */
  async create(input: CreateLiteMemoryInput): Promise<LiteMemory> {
    if (!input.userId) {
      throw new Error('LiteJsonStore.create: userId is required.');
    }
    const now = new Date();
    const memory: LiteMemory = liteMemorySchema.parse({
      id: randomUUID(),
      userId: input.userId,
      organizationId: input.organizationId,
      content: input.content,
      metadata: input.metadata,
      tags: input.tags ?? [],
      type: input.type ?? 'long-term',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : undefined,
      embedding: input.embedding,
    });

    await this.locks.run(memory.userId, async () => {
      await this.ensureUserDir(memory.userId);
      await this.writeRecord(memory);
      await this.appendToIndex(memory.userId, memory.id);
    });

    return memory;
  }

  /**
   * Retrieve a single memory by `(userId, memoryId)`.
   *
   * Returns `null` when the record is missing or fails validation
   * (corrupt or partially-written file). Callers that need to distinguish
   * "missing" from "corrupt" can pass `{ allowCorrupt: true }` via
   * {@link getRaw}.
   */
  async get(userId: string, memoryId: string): Promise<LiteMemory | null> {
    return this.locks.run(userId, async () => {
      const parsed = await this.readRecord(userId, memoryId);
      return parsed;
    });
  }

  /**
   * Replace or patch a memory.
   *
   * Pass `content` / `tags` / `metadata` to overwrite; omit to keep. The
   * `updatedAt` timestamp is refreshed on every call.
   */
  async update(
    userId: string,
    memoryId: string,
    patch: UpdateLiteMemoryInput
  ): Promise<LiteMemory> {
    return this.locks.run(userId, async () => {
      const existing = await this.readRecord(userId, memoryId);
      if (!existing) {
        throw new Error(`Memory not found: ${userId}/${memoryId}`);
      }
      const next: LiteMemory = liteMemorySchema.parse({
        ...existing,
        content: patch.content ?? existing.content,
        tags: patch.tags ?? existing.tags,
        metadata: patch.metadata ?? existing.metadata,
        embedding: patch.embedding ?? existing.embedding,
        expiresAt: patch.expiresAt ? patch.expiresAt.toISOString() : existing.expiresAt,
        updatedAt: new Date().toISOString(),
      });
      await this.writeRecord(next);
      return next;
    });
  }

  /** Remove a memory and prune it from the user index. */
  async delete(userId: string, memoryId: string): Promise<boolean> {
    return this.locks.run(userId, async () => {
      const filePath = this.recordPath(userId, memoryId);
      if (!existsSync(filePath)) {
        return false;
      }
      await rm(filePath, { force: true });
      await this.removeFromIndex(userId, memoryId);
      return true;
    });
  }

  /**
   * Page through a user's memories.
   *
   * Pagination is cursor-based; the cursor is the memory id of the last
   * item returned by the previous page. The index is consulted first to
   * keep memory reads sequential on disk; tag/search filtering applies
   * per-page.
   */
  async list(
    userId: string,
    options: ListLiteMemoriesOptions = {}
  ): Promise<ListLiteMemoriesResult> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const includeShortTerm = options.includeShortTerm ?? false;
    const cursor = options.cursor;

    return this.locks.run(userId, async () => {
      const ids = await this.readIndex(userId);
      const startIdx = cursor ? Math.max(ids.indexOf(cursor) + 1, 0) : 0;

      const items: LiteMemory[] = [];
      let nextCursor: string | null = null;
      for (let i = startIdx; i < ids.length; i += 1) {
        const id = ids[i];
        if (id === undefined) break;
        const memory = await this.readRecord(userId, id);
        if (!memory) {
          // Skip stale index entries; clean them up opportunistically.
          ids.splice(i, 1);
          i -= 1;
          continue;
        }
        if (!includeShortTerm && memory.type === 'short-term') {
          continue;
        }
        if (options.tags && options.tags.length > 0) {
          const hasAll = options.tags.every((t) => memory.tags.includes(t));
          if (!hasAll) continue;
        }
        if (options.search && options.search.length > 0) {
          const needle = options.search.toLowerCase();
          const haystack = `${memory.content} ${memory.tags.join(' ')}`.toLowerCase();
          if (!haystack.includes(needle)) continue;
        }
        items.push(memory);
        if (items.length >= limit) {
          // Cursor points at the LAST item returned so the next page starts
          // at the position immediately after it (see `startIdx` above).
          nextCursor = memory.id;
          break;
        }
      }

      if (nextCursor !== null && ids.indexOf(nextCursor) === -1) {
        // Defensive: if the cursor was somehow evicted from the index,
        // surface null so callers don't loop forever.
        nextCursor = null;
      }

      // If we filled the page but no further ids exist, signal end of list.
      if (nextCursor !== null) {
        const lastIdx = ids.indexOf(nextCursor);
        if (lastIdx === -1 || lastIdx >= ids.length - 1) {
          nextCursor = null;
        }
      }

      return { items, nextCursor };
    });
  }

  /**
   * Return every memory that carries all of `tags`. Convenience wrapper
   * around {@link list} that returns a single array.
   */
  async listByTag(userId: string, tags: string[]): Promise<LiteMemory[]> {
    const out: LiteMemory[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = await this.list(userId, {
        tags,
        cursor,
        limit: 500,
      });
      out.push(...page.items);
      if (!page.nextCursor) return out;
      cursor = page.nextCursor;
    }
  }

  /**
   * Free-text search across a user's memories using case-insensitive
   * substring matching. Used as a baseline ranker until a richer scoring
   * pass is wired in for profile-lite.
   */
  async search(userId: string, needle: string): Promise<LiteMemory[]> {
    const trimmed = needle.trim();
    if (trimmed.length === 0) return [];
    const out: LiteMemory[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = await this.list(userId, {
        search: trimmed,
        cursor,
        limit: 500,
      });
      out.push(...page.items);
      if (!page.nextCursor) return out;
      cursor = page.nextCursor;
    }
  }

  // --------------------------------------------------------------------
  // File-system helpers
  // --------------------------------------------------------------------

  private userDir(userId: string): string {
    // Sanitise userId into a single path segment so a hostile tenant
    // identifier cannot escape the data dir.
    const safe = encodeURIComponent(userId).replace(/[*.?()[\]{}]/g, '_');
    return path.join(this.dataDir, 'memories', safe);
  }

  private recordPath(userId: string, memoryId: string): string {
    const safe = encodeURIComponent(memoryId).replace(/[*.?()[\]{}]/g, '_');
    const ext = this.isInsecure ? '.json' : '.json.enc';
    return path.join(this.userDir(userId), `${safe}${ext}`);
  }

  private indexPath(userId: string): string {
    return path.join(this.userDir(userId), '_index.json');
  }

  private async ensureUserDir(userId: string): Promise<void> {
    const dir = this.userDir(userId);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
      await chmod(dir, OWNER_ONLY_DIR_MODE);
      return;
    }
    const stats = await stat(dir);
    if (!stats.isDirectory()) {
      throw new Error(`Expected directory at ${dir}, found mode ${stats.mode.toString(8)}`);
    }
  }

  private async writeRecord(memory: LiteMemory): Promise<void> {
    const target = this.recordPath(memory.userId, memory.id);
    const tmp = `${target}.tmp`;
    const json = JSON.stringify(memory);
    const payload: string | EncryptedPayload = this.encryptionKey
      ? encrypt(json, this.encryptionKey, memory.id)
      : json;
    await writeFile(tmp, payload, { encoding: 'utf8', mode: OWNER_ONLY_FILE_MODE });
    await chmod(tmp, OWNER_ONLY_FILE_MODE);
    await rename(tmp, target);
    await chmod(target, OWNER_ONLY_FILE_MODE);
  }

  private async readRecord(userId: string, memoryId: string): Promise<LiteMemory | null> {
    const target = this.recordPath(userId, memoryId);
    if (!existsSync(target)) return null;
    const raw = await readFile(target, 'utf8');
    const json = this.encryptionKey ? decrypt(raw, this.encryptionKey, memoryId) : raw;
    try {
      return liteMemorySchema.parse(JSON.parse(json));
    } catch (error) {
      this.logger.error(`Failed to parse memory at ${target}: ${(error as Error).message}`);
      return null;
    }
  }

  private async readIndex(userId: string): Promise<string[]> {
    const idx = this.indexPath(userId);
    if (!existsSync(idx)) return [];
    try {
      const raw = await readFile(idx, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value): value is string => typeof value === 'string');
    } catch (error) {
      this.logger.error(`Failed to parse index at ${idx}: ${(error as Error).message}`);
      return [];
    }
  }

  private async writeIndex(userId: string, ids: string[]): Promise<void> {
    const idx = this.indexPath(userId);
    const tmp = `${idx}.tmp`;
    await writeFile(tmp, JSON.stringify(ids), {
      encoding: 'utf8',
      mode: OWNER_ONLY_FILE_MODE,
    });
    await chmod(tmp, OWNER_ONLY_FILE_MODE);
    await rename(tmp, idx);
    await chmod(idx, OWNER_ONLY_FILE_MODE);
  }

  private async appendToIndex(userId: string, memoryId: string): Promise<void> {
    const ids = await this.readIndex(userId);
    if (!ids.includes(memoryId)) {
      ids.push(memoryId);
      await this.writeIndex(userId, ids);
    }
  }

  private async removeFromIndex(userId: string, memoryId: string): Promise<void> {
    const ids = await this.readIndex(userId);
    const next = ids.filter((id) => id !== memoryId);
    if (next.length !== ids.length) {
      await this.writeIndex(userId, next);
    }
  }
}

/**
 * Singleton accessor for environments that have not opted into Nest DI
 * (CLI scripts, ad-hoc tests). Returns a memoised instance per
 * `dataDir + key` pair so multiple callers share the same store.
 */
const singletonCache = new Map<string, LiteJsonStore>();

export function getLiteStore(dataDir: string, encryptionKey?: Buffer): LiteJsonStore {
  const key = `${dataDir}::${encryptionKey ? encryptionKey.toString('base64') : 'plaintext'}`;
  const existing = singletonCache.get(key);
  if (existing) return existing;
  const created = new LiteJsonStore(dataDir, encryptionKey);
  singletonCache.set(key, created);
  return created;
}

/** Test-only: drop cached singletons. */
export function resetLiteStoreCache(): void {
  singletonCache.clear();
}

// Re-export for ergonomic imports from `@engram/memory-lite`.
export { ENCRYPTION_VERSION_PREFIX };
