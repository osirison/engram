import { createHash } from 'node:crypto';

/**
 * Canonical content hash for import idempotency / drift detection. Byte-for-byte
 * the same formula as `IngestPipelineService.computeHash`
 * (`packages/memory-ltm/src/ingest/ingest-pipeline.service.ts:111`) so an
 * imported memory's hash matches the LTM exact-content dedup key (WP4 PLAN §T3
 * step 4). Kept as a free function to avoid a package→app dependency.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content.trim().toLowerCase()).digest('hex');
}
