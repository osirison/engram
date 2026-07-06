import type { MemoryEdge } from './edge-types.js';

/**
 * Obsidian-compatible `[[wikilink]]` helpers (WP3 PLAN §4.4 / §4.9).
 *
 * The inline `## Related` section is the human/graph-visible mirror of the
 * machine-readable frontmatter `links[]`. Link targets are always the memory
 * `id` (resolved via the target file's `aliases:[id]`), so links survive slug
 * renames without a global pre-pass.
 *
 * Inline scores are rounded to 2 decimals — this section is a lossy mirror; the
 * authoritative precise score lives in frontmatter.
 */

/** How many decimals a score is rendered with in the inline mirror. */
const INLINE_SCORE_DECIMALS = 2;

/** A wikilink parsed out of body/`## Related` text. */
export interface ParsedWikilink {
  /** Target memory id (before the optional `|display`). */
  target: string;
  /** Human display text after `|`, if present. */
  display?: string;
}

/** Emit a bare `[[target]]` or `[[target|display]]` token. */
export function emitWikilinkToken(target: string, display?: string): string {
  return display !== undefined && display.length > 0 ? `[[${target}|${display}]]` : `[[${target}]]`;
}

/** Options for {@link emitWikilink}. */
export interface EmitWikilinkOptions {
  /** Human display text rendered after `|` inside the link. */
  display?: string;
  /**
   * Single-doc mode: target an intra-document anchor (`#mem-<target>`) instead
   * of a separate note, so the one-file export's links resolve internally
   * (WP3 PLAN §4.4).
   */
  anchor?: boolean;
}

/**
 * Render a single edge as one `## Related` list-item body (without the leading
 * `- `), per §4.4. A `dangling` edge (target outside the export set, §4.9) is
 * rendered as plain text — never a live `[[…]]` — so Obsidian does not create a
 * phantom note.
 */
export function emitWikilink(edge: MemoryEdge, options: EmitWikilinkOptions = {}): string {
  const { display, anchor } = options;
  const scorePart =
    edge.score !== undefined ? ` (${edge.score.toFixed(INLINE_SCORE_DECIMALS)})` : '';

  if (edge.dangling) {
    return `**${edge.rel}** ${edge.target}${scorePart} (not in export)`;
  }
  const linkTarget = anchor ? `#mem-${edge.target}` : edge.target;
  return `**${edge.rel}** ${emitWikilinkToken(linkTarget, display)}${scorePart}`;
}

// A real wikilink, not preceded by a backslash (escaped brackets in body
// content are `\[\[…\]\]` and must not be parsed as links).
const WIKILINK_RE = /(?<!\\)\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;

/**
 * Extract every real (unescaped) `[[target|display]]` token from `text`, in
 * order. Tolerant of a missing `|display`. Escaped `\[\[…\]\]` are ignored.
 */
export function parseWikilinks(text: string): ParsedWikilink[] {
  const out: ParsedWikilink[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = m[1]?.trim();
    if (!target) continue;
    const display = m[2]?.trim();
    out.push(display ? { target, display } : { target });
  }
  return out;
}

/**
 * Escape literal `[[` / `]]` in memory content so they are not mistaken for
 * wikilinks by Obsidian or {@link parseWikilinks} (§4.8). Reversible via
 * {@link unescapeWikilinkBrackets} for byte-exact round-trip of content.
 */
export function escapeWikilinkBrackets(text: string): string {
  return text.replace(/\[\[/g, '\\[\\[').replace(/\]\]/g, '\\]\\]');
}

/** Inverse of {@link escapeWikilinkBrackets}. */
export function unescapeWikilinkBrackets(text: string): string {
  return text.replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]');
}
