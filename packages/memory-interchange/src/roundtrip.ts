import type { MemoryEdge } from './edge-types.js';
import type { Frontmatter, MemoryTierType } from './frontmatter.schema.js';
import type { ParsedDocument } from './parse.js';
import { normalizeContent } from './serialize.js';

/**
 * The **durable projection** of a memory (WP3 PLAN §4.10 — the G6 round-trip
 * contract). Export → parse → re-import into a clean DB must reproduce exactly
 * these fields for each memory:
 *
 *   - `id`, `type`, `scope`, `tags`, `content`
 *   - **durable** edges only (`origin: 'durable'`) — reduced to their graph
 *     identity `(rel, target, origin)`.
 *
 * It deliberately EXCLUDES:
 *   - volatile fields (`updatedAt`, `importance`, `accessCount`, `lastAccessedAt`,
 *     `detectedAt`, …) — they legitimately differ across time;
 *   - **derived** edges (duplicate/contradiction/superseded) — an importer
 *     regenerates them from detection, and comparing them would fail on the
 *     expected doubling.
 *
 * Comparing this projection (not the raw document) is what makes the round-trip
 * test pass *by construction* instead of fighting volatility. WP4's import side
 * must satisfy: `durableProjection(exported) ⊇ durableProjection(reimported)`.
 */
export interface DurableProjection {
  id: string;
  type: MemoryTierType;
  scope: string | null;
  tags: string[];
  content: string;
  /** Durable edges as `(rel, target, origin)`, deduped + sorted. */
  durableLinks: Array<Pick<MemoryEdge, 'rel' | 'target' | 'origin'>>;
}

interface DurableInput {
  id: string;
  type: MemoryTierType;
  scope?: string | null;
  tags: string[];
  content: string;
  links: readonly MemoryEdge[];
}

function normalizeDurableLinks(links: readonly MemoryEdge[]): DurableProjection['durableLinks'] {
  const seen = new Set<string>();
  const out: DurableProjection['durableLinks'] = [];
  for (const e of links) {
    if (e.origin !== 'durable') continue;
    const key = `${e.rel} ${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rel: e.rel, target: e.target, origin: e.origin });
  }
  out.sort((a, b) => (a.rel === b.rel ? cmp(a.target, b.target) : cmp(a.rel, b.rel)));
  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Build a {@link DurableProjection} from a memory + its collected edges. */
export function durableProjection(input: DurableInput): DurableProjection {
  return {
    id: input.id,
    type: input.type,
    scope: input.scope ?? null,
    tags: [...new Set(input.tags)].sort(),
    content: normalizeContent(input.content),
    durableLinks: normalizeDurableLinks(input.links),
  };
}

/** Build a {@link DurableProjection} from a parsed document (frontmatter + body). */
export function durableProjectionOfDocument(doc: ParsedDocument): DurableProjection {
  const fm: Frontmatter = doc.frontmatter;
  return durableProjection({
    id: fm.id,
    type: fm.type,
    scope: fm.scope ?? null,
    tags: fm.tags,
    content: doc.body,
    links: fm.links,
  });
}
