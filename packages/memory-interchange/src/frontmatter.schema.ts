import { z } from 'zod';
import { edgeSchema } from './edge-types.js';

/**
 * ISO-8601 UTC timestamp (e.g. `2026-06-01T10:00:00.000Z`). All interchange
 * timestamps are serialized in this form for determinism (WP3 PLAN §4.2).
 */
const isoDatetime = z.string().datetime();

/** Memory tier, mirrored from ENGRAM's `Memory.type`. */
export const memoryTypeSchema = z.enum(['short-term', 'long-term']);

export type MemoryTierType = z.infer<typeof memoryTypeSchema>;

/**
 * Import lineage. On export from ENGRAM: `{ source: 'engram', importedFrom: null }`.
 * WP4 importers overwrite `source`/`importedFrom` to record where a memory came
 * from (e.g. `claude-code`, `cursor`).
 */
export const provenanceSchema = z
  .object({
    source: z.string().min(1),
    importedFrom: z.string().nullable(),
  })
  .strict();

export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * The canonical frontmatter contract (WP3 PLAN §4.2) — the single source of
 * truth for the byte-level document format, consumed by both export (WP3) and
 * import (WP4). A Zod `.strict()` schema on both sides turns any drift into a
 * test/compile failure instead of silent data loss (gap G6).
 *
 * The field declaration order below is also the emit order used by the
 * serializer (see `serialize.ts`); `.strict()` rejects any unknown key so an
 * importer cannot smuggle un-contracted data through.
 *
 * Omit-when-empty rules (enforced by the serializer, tolerated by the parser):
 * `scope`, `organizationId`, `expiresAt`, and `metadata` are omitted when
 * null/empty; `tags`, `aliases`, and `links` are always present (possibly `[]`).
 */
export const frontmatterSchema = z
  .object({
    /** Contract version — {@link MEMORY_INTERCHANGE_VERSION}. */
    schemaVersion: z.string().min(1),
    /** cuid2 memory id — globally unique join key that edges target. */
    id: z.string().min(1),
    type: memoryTypeSchema,
    /** Owner / tenant (provenance). */
    userId: z.string().min(1),
    /** Optional namespace (e.g. `project:engram`); omitted when null. */
    scope: z.string().min(1).optional(),
    /** Optional org id; omitted when null. */
    organizationId: z.string().min(1).optional(),
    /** Sorted + deduped. */
    tags: z.array(z.string()),
    createdAt: isoDatetime,
    updatedAt: isoDatetime,
    /** STM only; null/omitted for LTM. */
    expiresAt: isoDatetime.nullable().optional(),
    /** Lets `[[<id>]]` resolve regardless of the file's cosmetic slug. */
    aliases: z.array(z.string()),
    /** Typed edges — sorted by (rel, target), deduped. */
    links: z.array(edgeSchema),
    /** Sanitized non-relationship, non-volatile custom keys; omitted when empty. */
    metadata: z.record(z.string(), z.unknown()).optional(),
    provenance: provenanceSchema,
  })
  .strict();

export type Frontmatter = z.infer<typeof frontmatterSchema>;
