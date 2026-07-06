import { z } from 'zod';

/**
 * Closed vocabulary of typed memory→memory edges (WP3 PLAN §4.3). Emitted both
 * in frontmatter `links[]` (machine-readable) and inline `## Related` wikilinks
 * (Obsidian graph-visible). The set is intentionally small and symmetric:
 * `superseded-by`/`supersedes` and `derived-from`/`source-of` are inverse pairs;
 * `relates-to`/`duplicate-of`/`contradicts` are their own inverses.
 */
export const EDGE_TYPES = [
  'relates-to',
  'duplicate-of',
  'contradicts',
  'superseded-by',
  'supersedes',
  'derived-from',
  'source-of',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * Inverse of each edge type, used by the export edge collector to emit the
 * reciprocal edge on the target memory (WP3 PLAN §4.3 mapping table). Kept in
 * the shared lib so both export and import agree on symmetry.
 */
export const EDGE_INVERSE: Readonly<Record<EdgeType, EdgeType>> = {
  'relates-to': 'relates-to',
  'duplicate-of': 'duplicate-of',
  contradicts: 'contradicts',
  'superseded-by': 'supersedes',
  supersedes: 'superseded-by',
  'derived-from': 'source-of',
  'source-of': 'derived-from',
};

/**
 * Provenance class of an edge (WP3 PLAN §4.3):
 * - `derived`  — reproducible by re-running detection on re-ingest
 *                (duplicate/contradiction/superseded). Excluded from the
 *                round-trip durable projection; import restores with detection
 *                disabled so they are not doubled.
 * - `durable`  — has no reproducible source (insight `derived-from`/`source-of`,
 *                future authored `relates-to`). MUST survive round-trip as data.
 *
 * Note: this is the *export contract* origin. The `MemoryLink.origin` DB column
 * uses `authored`/`derived`; the T4 collector maps `authored → durable`.
 */
export const EDGE_ORIGINS = ['durable', 'derived'] as const;

export type EdgeOrigin = (typeof EDGE_ORIGINS)[number];

/**
 * A single typed edge as it appears in frontmatter `links[]` and (mirrored) in
 * the inline `## Related` section. `target` is always a memory `id` — the join
 * key — never a slug/filename, so links are robust to renames (WP3 PLAN §4.2).
 */
export const edgeSchema = z
  .object({
    /** Edge type from the closed {@link EDGE_TYPES} vocabulary. */
    rel: z.enum(EDGE_TYPES),
    /** Target memory `id` (the join key; resolved via the target's `aliases`). */
    target: z.string().min(1),
    /** durable vs derived — see {@link EDGE_ORIGINS}. */
    origin: z.enum(EDGE_ORIGINS),
    /** Similarity score for detection-derived edges (duplicate/contradiction). */
    score: z.number().optional(),
    /** Human-readable annotation (e.g. contradiction reason, insight topic). */
    note: z.string().optional(),
    /**
     * True when the target is outside the current (filtered) export set. The
     * frontmatter entry is retained (it records the true edge) but the inline
     * wikilink renders as plain text so Obsidian creates no phantom note
     * (WP3 PLAN §4.9).
     */
    dangling: z.boolean().optional(),
  })
  .strict();

export type MemoryEdge = z.infer<typeof edgeSchema>;
