import { LiteJsonStore } from '@engram/memory-lite';

/**
 * Read the `dataDir` field off a `LiteJsonStore` instance.
 *
 * The field is `private readonly` on the class; migration tooling is the
 * single legitimate consumer and always knows the directory it constructed
 * the store with, so we reach it via a typed cast gated behind a runtime
 * check.
 */
export function resolveDataDir(
  store: LiteJsonStore,
  callerName: string,
): string {
  const value = (store as unknown as { dataDir?: unknown }).dataDir;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${callerName}: LiteJsonStore.dataDir is not accessible. ` +
        'Pass dataDir via options.dataDir when constructing the service.',
    );
  }
  return value;
}

/**
 * Recursively sort the keys of a plain JSON-compatible object so that
 * `JSON.stringify` produces a stable, order-independent representation.
 * Arrays are left in insertion order (element order is semantically
 * significant); only object keys are sorted.
 */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeys(record[key]);
    }
    return out;
  }
  return value;
}
