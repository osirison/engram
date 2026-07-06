import { parse as yamlParse } from 'yaml';
import { frontmatterSchema, type Frontmatter } from './frontmatter.schema.js';
import { unescapeWikilinkBrackets } from './wikilink.js';
import { RELATED_MARKER, unescapeRelatedMarker } from './serialize.js';

export interface ParsedDocument {
  /** Validated canonical frontmatter (the authoritative edge list lives here). */
  frontmatter: Frontmatter;
  /**
   * The recovered memory content (unescaped, LF, trailing-stripped) — i.e. the
   * canonical form of the original content. The `## Related` mirror is dropped:
   * it is a lossy human view of `frontmatter.links`.
   */
  body: string;
}

// Frontmatter block at the very top: `---\n<yaml>\n---\n`. Non-greedy so a `---`
// inside the body cannot be mistaken for the closing fence.
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

/**
 * Inverse of `serializeMemory` (multi mode). Parses a standalone Obsidian note
 * back into `{ frontmatter, body }` (WP3 PLAN §4.1; consumed by WP4 import + the
 * T9 round-trip test). `parseDocument(serializeMemory(x))` reproduces the
 * frontmatter projection and canonical content exactly.
 *
 * Throws if the input has no leading frontmatter block or the frontmatter fails
 * the {@link frontmatterSchema} contract.
 */
export function parseDocument(md: string): ParsedDocument {
  const normalized = md.replace(/\r\n?/g, '\n');
  const match = FRONTMATTER_RE.exec(normalized);
  if (!match) {
    throw new Error('parseDocument: no leading `---` frontmatter block found');
  }

  const frontmatter = frontmatterSchema.parse(yamlParse(match[1] ?? ''));

  // Everything after the closing fence, minus the single structural blank line
  // the serializer inserts before the body.
  let rest = normalized.slice(match[0].length);
  if (rest.startsWith('\n')) rest = rest.slice(1);

  // Split the content off from the `## Related` mirror at the sentinel.
  const markerIdx = rest.indexOf(`\n\n${RELATED_MARKER}`);
  const contentRegion = markerIdx >= 0 ? rest.slice(0, markerIdx) : rest.replace(/\n$/, '');

  return { frontmatter, body: unescapeWikilinkBrackets(unescapeRelatedMarker(contentRegion)) };
}
