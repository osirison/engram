import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { LiteJsonStore, LiteMemory } from '@engram/memory-lite';

/**
 * Helper utilities for enumerating memories held in a profile-lite
 * {@link LiteJsonStore}.
 *
 * The store deliberately does not expose `listAllUsers` or a `count`
 * method (the migration tooling is the only consumer that needs them).
 * These helpers translate the documented on-disk layout
 * (`<dataDir>/memories/<encodedUserId>/<memoryId>.<ext>`) into a
 * paginated stream callers can hand to the backfill service without
 * reaching into `LiteJsonStore` internals.
 *
 * The store's per-user concurrency lock still applies inside `list()`,
 * so concurrent writes from {@link DualWriteCoordinator} are observed in
 * order while backfill reads.
 */

/** Per-user pagination batch. */
const ENUM_BATCH_LIMIT = 100;

/** Per-user short-term memories are excluded from the migration count. */
const DEFAULT_INCLUDE_SHORT_TERM = false;

/** Resolved shape of a single enumerator page. */
export interface LiteEnumeratorPage {
  userId: string;
  items: LiteMemory[];
  nextCursor: string | null;
}

/**
 * Enumerate user directories under the store's `memories/` root.
 *
 * Each directory is decoded back to its raw userId so callers can pass
 * the id back to `LiteJsonStore.list()`. The encoding mirrors
 * `LiteJsonStore.userDir()` (URI-encode then strip path-safe chars).
 */
export async function enumerateLiteUsers(dataDir: string): Promise<string[]> {
  const root = path.join(dataDir, 'memories');
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
  return entries.map((entry) => decodeUserId(entry));
}

/**
 * Stream one page of a user's memories through the public
 * {@link LiteJsonStore.list} surface. Cursor is opaque to callers —
 * pass the previous page's `nextCursor` back in on the next call.
 */
export async function listLitePage(
  store: LiteJsonStore,
  userId: string,
  cursor: string | null,
  includeShortTerm: boolean = DEFAULT_INCLUDE_SHORT_TERM,
): Promise<LiteEnumeratorPage> {
  const page = await store.list(userId, {
    cursor: cursor ?? undefined,
    limit: ENUM_BATCH_LIMIT,
    includeShortTerm,
  });
  return {
    userId,
    items: page.items,
    nextCursor: page.nextCursor,
  };
}

/**
 * Count the long-term memories for a user. Short-term memories are
 * excluded because they are intentionally local-only and have no
 * profile-enterprise representation.
 */
export async function countLiteMemories(
  store: LiteJsonStore,
  userId: string,
  includeShortTerm: boolean = DEFAULT_INCLUDE_SHORT_TERM,
): Promise<number> {
  let total = 0;
  let cursor: string | null = null;
  // Cap the loop iterations as a defensive guard against accidental
  // cursor loops. 50_000 memories per user is well above the LTM quota
  // (10_000) and gives a healthy ceiling.
  for (let i = 0; i < 500; i += 1) {
    const page = await store.list(userId, {
      cursor: cursor ?? undefined,
      limit: ENUM_BATCH_LIMIT,
      includeShortTerm,
    });
    total += page.items.length;
    if (!page.nextCursor) return total;
    cursor = page.nextCursor;
  }
  throw new Error(
    `countLiteMemories: cursor loop exceeded 500 pages for ${userId}`,
  );
}

/**
 * Mirror of `LiteJsonStore.userDir()`: undo the encoding used to make
 * a userId safe as a single path segment. Returns the input unchanged
 * when the encoded form does not decode (defensive against malformed
 * directory names from older versions).
 */
function decodeUserId(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
