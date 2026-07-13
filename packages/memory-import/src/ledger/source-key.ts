// Root-namespaced ledger keys (#236 — multi-root namespacing).
//
// The import ledger is keyed `(userId, sourceKey)`. Adapters emit the BARE key
// `<tool>:<relpath>[#anchor]`, which is only unique within one import root: two
// watched roots that share a relative path (two repos each with a `CLAUDE.md`)
// collide on the same ledger row and thrash on alternating re-imports.
//
// Fix: the pipeline namespaces the LEDGER key with a stable discriminator of
// the resolved import root — `<tool>@<fp12>:<relpath>[#anchor]` where `fp12` is
// the first 12 hex chars of sha256(realpath(root)). The `@@unique([userId,
// sourceKey])` key STRUCTURE is unchanged (pinned cross-campaign seam); only
// the VALUE grows a root discriminator. The fingerprint is inserted BEFORE the
// `:` so the `#anchor` suffix parse (link resolver's `splitSourceKey`) is
// unaffected.
//
// Compatibility: rows written before namespacing live under the bare key. On a
// ledger miss for the namespaced key the pipeline probes the bare key and, when
// found, renames that row in place (`ImportLedgerService.migrateKey`) — a
// one-time upgrade per fact that keeps the row's memoryId, so a re-import
// updates the same memory instead of creating a duplicate. When two roots
// shared one bare row, the first root to re-import claims it; the other root
// then creates its own row (and, for byte-identical content, merges into the
// existing memory via the multi-source provenance path).

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** Length of the hex root fingerprint embedded in namespaced source keys. */
export const ROOT_FINGERPRINT_LENGTH = 12;

/**
 * Stable discriminator of an import root: first 12 hex chars of
 * sha256(realpath(root)). Symlinks are dereferenced when the root exists so
 * two spellings of the same directory agree; a non-existent path (unit-test
 * IRs) falls back to `path.resolve`.
 */
export function rootFingerprint(rootPath: string): string {
  let normalized: string;
  try {
    normalized = realpathSync.native(rootPath);
  } catch {
    normalized = resolve(rootPath);
  }
  return createHash('sha256').update(normalized).digest('hex').slice(0, ROOT_FINGERPRINT_LENGTH);
}

/**
 * Namespace a bare adapter source key with the import-root fingerprint:
 * `<tool>:<relpath>[#anchor]` → `<tool>@<fp12>:<relpath>[#anchor]`.
 * Idempotent inputs are the caller's job — adapters always emit bare keys.
 */
export function namespaceSourceKey(bareSourceKey: string, rootPath: string): string {
  const fp = rootFingerprint(rootPath);
  const sep = bareSourceKey.indexOf(':');
  if (sep < 0) return `${bareSourceKey}@${fp}`; // defensive: no tool prefix
  return `${bareSourceKey.slice(0, sep)}@${fp}${bareSourceKey.slice(sep)}`;
}
