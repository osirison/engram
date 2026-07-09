// Shared fact-assembly used by every source adapter (T6–T11). Adapters differ
// only in file discovery + source-specific tags/frontmatter mapping + chunking
// default; the common "split frontmatter → chunk-or-atomic → build facts with
// links + sourceKey" flow lives here so all adapters stay byte-consistent.

import { RELATED_MARKER } from '@engram/memory-interchange';
import { splitFrontmatter } from '../parse/frontmatter.js';
import { extractLinks } from '../parse/links.js';
import { chunkByHeadings, shouldSplitAtomic } from '../parse/chunk.js';
import type { ImportedFact, SourceTool } from '../ir/types.js';

/**
 * Drop ENGRAM's `## Related` mirror when re-importing a canonical export (G6).
 * The serializer appends a human-readable wikilink mirror of `frontmatter.links`
 * behind the `RELATED_MARKER` sentinel; the authoritative edges live in the
 * frontmatter, so the mirror is lossy and MUST NOT accrete into stored content
 * (else a second export would double it). Mirrors `parseDocument`, which strips
 * the same marker.
 *
 * Gated on `isCanonical` (frontmatter carries `schemaVersion`) so this only ever
 * touches ENGRAM's own exports — a plain note that merely happens to contain the
 * sentinel string is left byte-for-byte intact.
 */
function stripRelatedMirror(body: string, isCanonical: boolean): string {
  if (!isCanonical) return body;
  const idx = body.indexOf(RELATED_MARKER);
  return idx >= 0 ? body.slice(0, idx).replace(/\s+$/, '') : body;
}

/** How a file becomes facts (D6). */
export type ChunkMode =
  | 'atomic' // exactly one memory (unless empty)
  | 'split' // always H2-chunk
  | 'auto'; // atomic, but H2-chunk when ≥2 H2s AND >2KB (shouldSplitAtomic)

/** `<tool>:<relpath>[#anchor]` — the individually-addressable fact key. */
export function makeSourceKey(tool: SourceTool, sourcePath: string, anchor?: string): string {
  return `${tool}:${sourcePath}${anchor ? `#${anchor}` : ''}`;
}

/** Best-effort human title from frontmatter (`title` then `name`). */
function pickTitle(frontmatter: Record<string, unknown> | undefined): string | undefined {
  for (const key of ['title', 'name']) {
    const v = frontmatter?.[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

interface MkFactInput {
  sourceKey: string;
  sourceTool: SourceTool;
  sourcePath: string;
  content: string;
  tags: string[];
  anchor?: string;
  title?: string;
  frontmatter?: Record<string, unknown>;
  linkFrontmatter?: Record<string, unknown>;
}

function mkFact(input: MkFactInput): ImportedFact | null {
  const content = input.content.trim();
  if (content.length === 0) return null; // never persist an empty fact
  const fact: ImportedFact = {
    localId: input.sourceKey,
    sourceKey: input.sourceKey,
    sourceTool: input.sourceTool,
    sourcePath: input.sourcePath,
    content,
    tags: [...new Set(input.tags)],
    links: extractLinks(content, input.sourcePath, input.linkFrontmatter),
  };
  if (input.anchor !== undefined) fact.anchor = input.anchor;
  if (input.title !== undefined) fact.title = input.title;
  if (input.frontmatter !== undefined) fact.frontmatter = input.frontmatter;
  return fact;
}

export interface BuildFactsInput {
  /** Raw file contents (frontmatter still attached). */
  content: string;
  /** Path relative to the IR `rootPath`. */
  sourcePath: string;
  sourceTool: SourceTool;
  /** Base tags applied to every fact from this file. */
  tags: string[];
  chunkMode: ChunkMode;
}

/**
 * Turn one source file into its `ImportedFact`s. Frontmatter is parsed once and
 * attached (with its canonical `links[]` edges) to the ATOMIC fact or the FIRST
 * chunk only, so a chunked file's frontmatter edges are not duplicated across
 * sections. Empty facts are dropped.
 */
export function buildFacts(input: BuildFactsInput): ImportedFact[] {
  const { content, sourcePath, sourceTool, tags, chunkMode } = input;
  const { frontmatter, body: rawBody } = splitFrontmatter(content);
  const isCanonical = typeof frontmatter?.['schemaVersion'] === 'string';
  const body = stripRelatedMirror(rawBody, isCanonical);

  const doSplit = chunkMode === 'split' || (chunkMode === 'auto' && shouldSplitAtomic(body));

  if (!doSplit) {
    const fact = mkFact({
      sourceKey: makeSourceKey(sourceTool, sourcePath),
      sourceTool,
      sourcePath,
      content: body,
      tags,
      title: pickTitle(frontmatter),
      frontmatter,
      linkFrontmatter: frontmatter,
    });
    return fact ? [fact] : [];
  }

  const facts: ImportedFact[] = [];
  chunkByHeadings(body).forEach((section, idx) => {
    const isFirst = idx === 0;
    const fact = mkFact({
      sourceKey: makeSourceKey(sourceTool, sourcePath, section.anchor),
      sourceTool,
      sourcePath,
      anchor: section.anchor,
      content: section.content,
      tags,
      title: section.title ?? (isFirst ? pickTitle(frontmatter) : undefined),
      frontmatter: isFirst ? frontmatter : undefined,
      linkFrontmatter: isFirst ? frontmatter : undefined,
    });
    if (fact) facts.push(fact);
  });
  return facts;
}
