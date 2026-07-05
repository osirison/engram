import { Prisma } from '@prisma/client';

import type { SortField, SortOrder } from './types';

/**
 * Opaque keyset (seek) pagination cursor for the memory list (WP2 T1/D8).
 *
 * Offset pagination (`skip`) drops or duplicates rows when items are inserted or
 * deleted between page fetches — a real hazard given qp's concurrent agents. A
 * keyset cursor instead seeks past the last row of the previous page using the
 * `(sortField, id)` pair, so the walk is stable under concurrent churn.
 *
 * `v` is the sort-field value as epoch milliseconds (both sort fields — createdAt
 * and updatedAt — are Date columns); `id` is the tiebreak for equal sort values.
 */
export interface KeysetCursor {
  v: number;
  id: string;
}

/** Encode a cursor as a URL-safe, opaque base64 token. */
export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Decode a cursor token. Returns `null` on ANY malformed input — a bad or legacy
 * (numeric offset) cursor is treated as "first page" rather than throwing, so a
 * stale tab self-heals instead of erroring.
 */
export function decodeCursor(raw: string | null | undefined): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as KeysetCursor).v === 'number' &&
      Number.isFinite((parsed as KeysetCursor).v) &&
      typeof (parsed as KeysetCursor).id === 'string'
    ) {
      return { v: (parsed as KeysetCursor).v, id: (parsed as KeysetCursor).id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the direction-aware seek predicate for a cursor. For `desc` order the
 * next page holds rows whose sort value is strictly less than the cursor, or
 * equal with a strictly smaller id (mirror with `gt` for `asc`). AND this into
 * the base filter and order by `(sortField, id)` in the same direction.
 */
export function keysetWhere(
  sortBy: SortField,
  sortOrder: SortOrder,
  cursor: KeysetCursor
): Prisma.MemoryWhereInput {
  const value = new Date(cursor.v);
  const comparator = sortOrder === 'desc' ? 'lt' : 'gt';
  return {
    OR: [
      { [sortBy]: { [comparator]: value } },
      { [sortBy]: value, id: { [comparator]: cursor.id } },
    ],
  };
}
