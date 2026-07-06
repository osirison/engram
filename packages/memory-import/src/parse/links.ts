// Link extraction + locator normalization shared by every adapter (WP4 PLAN
// §T1 step 5). Two authored link syntaxes (§3.0) plus canonical frontmatter
// edges are normalized to a resolver-ready `targetLocator`:
//   - wikilink `[[stem]]`        → `slug:<normalized-stem>`
//   - relative md `[t](rel.md)`  → `path:<repo-relative>[#anchor]`
//   - frontmatter `links[]` edge → `id:<memoryId>` (round-trip / ENGRAM vaults)
// Wikilink parsing + slug rules are REUSED from `@engram/memory-interchange` so
// import and export agree byte-for-byte (G6).

import { posix as posixPath } from 'node:path';
import { EDGE_TYPES, parseWikilinks, slugify, type EdgeType } from '@engram/memory-interchange';
import type { ImportedFact, ImportedLink } from '../ir/types.js';

const EDGE_TYPE_SET: ReadonlySet<string> = new Set(EDGE_TYPES);
const DEFAULT_REL: EdgeType = 'relates-to';

/** Markdown-ish target extensions that can plausibly become an imported memory. */
const MARKDOWN_EXT_RE = /\.(md|markdown|mdc)$/i;

/** Standard markdown link `[text](url)`, excluding image embeds `![text](url)`. */
const MD_LINK_RE = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
/** Arrow form `[text] → url` / `[text] -> url` (seen in some instruction files). */
const ARROW_LINK_RE = /\[[^\]]*\]\s*(?:→|->)\s*(\S+)/g;

/** Protocol / non-file targets we never treat as inter-memory links. */
function isExternalTarget(url: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(url) || // scheme: http:, mailto:, etc.
    url.startsWith('//') ||
    url.startsWith('#') // pure in-document anchor
  );
}

/** Normalize a wikilink target (`Feedback Worktree#heading`) to `slug:<slug>`. */
export function wikilinkLocator(rawTarget: string): string {
  const stem = (rawTarget.split('#')[0] ?? '').trim();
  return `slug:${slugify(stem)}`;
}

/**
 * Filename stem with known markdown compound/simple extensions stripped
 * (`x.instructions.md` → `x`, `y.mdc` → `y`), then slug-normalized.
 */
export function fileStemSlug(fileName: string): string {
  const base = fileName.replace(/\.(instructions\.md|md|markdown|mdc)$/i, '');
  return slugify(base);
}

/** Normalize a relative link resolved against the containing file's directory. */
function relativeLocator(sourceRelPath: string, url: string): string | null {
  const [rawPath, anchor] = splitAnchor(url);
  if (rawPath.length === 0) return null; // anchor-only → not an inter-file link
  if (!MARKDOWN_EXT_RE.test(rawPath)) return null; // dir/code link → skip (avoids dangling spam)
  const dir = posixPath.dirname(sourceRelPath);
  let resolved = posixPath.normalize(posixPath.join(dir, rawPath));
  resolved = resolved.replace(/^\.\//, '');
  return `path:${resolved}${anchor ? `#${anchor}` : ''}`;
}

function splitAnchor(url: string): [string, string | undefined] {
  const hashIdx = url.indexOf('#');
  if (hashIdx < 0) return [url, undefined];
  return [url.slice(0, hashIdx), url.slice(hashIdx + 1) || undefined];
}

/** Extract inline `[[wikilink]]` targets as `slug:` links (dedup within body). */
export function extractWikilinks(body: string): ImportedLink[] {
  const out: ImportedLink[] = [];
  const seen = new Set<string>();
  for (const { target } of parseWikilinks(body)) {
    const locator = wikilinkLocator(target);
    if (locator === 'slug:memory' && target.trim().length === 0) continue;
    if (seen.has(locator)) continue;
    seen.add(locator);
    out.push({ kind: 'wikilink', rawTarget: target, targetLocator: locator, relType: DEFAULT_REL });
  }
  return out;
}

/** Extract relative markdown links (standard + arrow form) as `path:` links. */
export function extractRelativeLinks(body: string, sourceRelPath: string): ImportedLink[] {
  const out: ImportedLink[] = [];
  const seen = new Set<string>();
  for (const re of [MD_LINK_RE, ARROW_LINK_RE]) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const url = (m[1] ?? '').trim();
      if (url.length === 0 || isExternalTarget(url)) continue;
      const locator = relativeLocator(sourceRelPath, url);
      if (!locator || seen.has(locator)) continue;
      seen.add(locator);
      out.push({
        kind: 'md-relative',
        rawTarget: url,
        targetLocator: locator,
        relType: DEFAULT_REL,
      });
    }
  }
  return out;
}

/**
 * Extract canonical typed edges from a `links[]` frontmatter array (the shape
 * emitted by WP3 export / present in ENGRAM Obsidian vaults). Each becomes an
 * `id:<target>` locator so a re-import re-resolves to the same memory. Non-edge
 * or unknown-rel entries are skipped. Derived edges are excluded — an importer
 * regenerates them from detection (interchange `roundtrip.ts`).
 */
export function extractFrontmatterLinks(
  frontmatter: Record<string, unknown> | undefined
): ImportedLink[] {
  const raw = frontmatter?.['links'];
  if (!Array.isArray(raw)) return [];
  const out: ImportedLink[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const rel = (entry as Record<string, unknown>)['rel'];
    const target = (entry as Record<string, unknown>)['target'];
    const origin = (entry as Record<string, unknown>)['origin'];
    if (typeof rel !== 'string' || !EDGE_TYPE_SET.has(rel)) continue;
    if (typeof target !== 'string' || target.length === 0) continue;
    if (origin === 'derived') continue; // regenerated by detection, not re-imported as authored
    const locator = `id:${target}`;
    const key = `${rel} ${locator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'frontmatter-ref',
      rawTarget: target,
      targetLocator: locator,
      relType: rel as EdgeType,
    });
  }
  return out;
}

/**
 * All inter-memory links for one fact: canonical frontmatter edges first (they
 * carry explicit rel types), then inline wikilinks, then relative md links.
 * Deduped by `(relType, targetLocator)` — the identity the link upsert keys on.
 *
 * When the frontmatter carries a `schemaVersion` (the marker of a canonical
 * ENGRAM export from WP3), its `links[]` are authoritative and the inline
 * `## Related` wikilinks are a lossy MIRROR of them — extracting both would
 * create a spurious dangling `slug:<id>` link per edge. So for canonical docs
 * we take only the frontmatter edges, keeping the export→import round-trip clean
 * (G6).
 */
export function extractLinks(
  body: string,
  sourceRelPath: string,
  frontmatter?: Record<string, unknown>
): ImportedLink[] {
  const frontmatterLinks = extractFrontmatterLinks(frontmatter);
  const isCanonicalExport =
    typeof frontmatter?.['schemaVersion'] === 'string' &&
    (frontmatter['schemaVersion'] as string).length > 0;
  const merged = isCanonicalExport
    ? frontmatterLinks
    : [
        ...frontmatterLinks,
        ...extractWikilinks(body),
        ...extractRelativeLinks(body, sourceRelPath),
      ];
  const seen = new Set<string>();
  const out: ImportedLink[] = [];
  for (const link of merged) {
    const key = `${link.relType} ${link.targetLocator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

/**
 * The locators that resolve TO `fact` (its identity in the link graph): its
 * repo-relative `path:` (with section anchor), its filename-stem `slug:`, and
 * its frontmatter `name` slug when present. T5's resolver indexes facts by these.
 */
export function deriveFactLocators(
  fact: Pick<ImportedFact, 'sourcePath' | 'anchor' | 'frontmatter'>
): string[] {
  const locators = new Set<string>();
  locators.add(`path:${fact.sourcePath}${fact.anchor ? `#${fact.anchor}` : ''}`);
  const fileName = posixPath.basename(fact.sourcePath);
  const stemSlug = fileStemSlug(fileName);
  if (stemSlug.length > 0) locators.add(`slug:${stemSlug}`);
  const fmName = fact.frontmatter?.['name'];
  if (typeof fmName === 'string' && fmName.trim().length > 0) {
    locators.add(`slug:${slugify(fmName)}`);
  }
  return [...locators];
}
