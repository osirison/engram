// Section chunking for monolithic instruction files (WP4 PLAN §D6). Splits a
// document at H2 (`##`) boundaries, folds fragment sections forward, and hard-
// splits any section exceeding the ingest char limit. Emits a stable section
// slug/anchor so `sourceKey` chunks are individually addressable and re-runs
// update the right chunk.

import { slugify } from '@engram/memory-interchange';

/**
 * Max chars per persisted chunk. Mirrors `INGEST_CHUNK_CHAR_LIMIT` in
 * `apps/mcp-server/src/memory/conversation-chunking.ts` (kept in sync by value;
 * re-declared here to avoid a dependency from a package onto the app).
 */
export const INGEST_CHUNK_CHAR_LIMIT = 10_240;

/** Sections shorter than this fold into the following section (no fragments). */
export const MIN_SECTION_CHARS = 200;

/** An atomic file splits only when it has ≥2 H2s AND exceeds this size (D6). */
export const ATOMIC_SPLIT_THRESHOLD = 2_048;

export interface Section {
  /** URL/slug-safe section id used as the `sourceKey` anchor. */
  anchor: string;
  /** The H2 heading text, or undefined for the pre-heading `overview`. */
  title?: string;
  content: string;
}

/** True when an H2 heading (`## `, not `### `) begins this line. */
function isH2(line: string): boolean {
  return /^##(?!#)[ \t]+\S/.test(line);
}

function headingText(line: string): string {
  return line.replace(/^##[ \t]+/, '').trim();
}

interface RawSection {
  title?: string;
  content: string;
}

/** Split into a preamble (title-less) plus one entry per H2 block. */
function splitRawSections(content: string): RawSection[] {
  const lines = content.split('\n');
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  const preamble: string[] = [];

  for (const line of lines) {
    if (isH2(line)) {
      if (current) sections.push(current);
      current = { title: headingText(line), content: `${line}\n` };
    } else if (current) {
      current.content += `${line}\n`;
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);

  const preambleText = preamble.join('\n').trim();
  const result: RawSection[] = [];
  if (preambleText.length > 0) result.push({ content: preambleText });
  for (const s of sections) result.push({ title: s.title, content: s.content.trimEnd() });
  return result;
}

/** Fold any section shorter than {@link MIN_SECTION_CHARS} into the next one. */
function foldFragments(sections: RawSection[]): RawSection[] {
  const out: RawSection[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!s) continue;
    const next = sections[i + 1];
    if (s.content.trim().length < MIN_SECTION_CHARS && next) {
      // Prepend the fragment to the next section; keep the next section's title.
      next.content = `${s.content}\n\n${next.content}`;
      continue;
    }
    out.push(s);
  }
  return out;
}

/** Paragraph-boundary hard split of an oversized section body. */
function hardSplit(content: string, limit: number): string[] {
  if (content.length <= limit) return [content];
  const paragraphs = content.split(/\n{2,}/);
  const parts: string[] = [];
  let buf = '';
  for (const para of paragraphs) {
    const candidate = buf.length === 0 ? para : `${buf}\n\n${para}`;
    if (candidate.length > limit && buf.length > 0) {
      parts.push(buf);
      buf = para;
    } else if (candidate.length > limit) {
      // A single paragraph over the limit: split on char boundary as a last resort.
      for (let i = 0; i < para.length; i += limit) parts.push(para.slice(i, i + limit));
      buf = '';
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) parts.push(buf);
  return parts;
}

/** Make an anchor unique within the doc by suffixing `-2`, `-3`, … on collision. */
function uniqueAnchor(base: string, used: Set<string>): string {
  const root = base.length > 0 ? base : 'section';
  let anchor = root;
  let n = 2;
  while (used.has(anchor)) anchor = `${root}-${n++}`;
  used.add(anchor);
  return anchor;
}

/**
 * Chunk `content` into H2 sections per D6: preamble → `overview`; fragment
 * sections fold forward; oversized sections hard-split with `-part-N` anchors.
 * A document with no H2 returns a single `overview` section.
 */
export function chunkByHeadings(content: string): Section[] {
  const folded = foldFragments(splitRawSections(content));
  if (folded.length === 0) return [];

  const used = new Set<string>();
  const out: Section[] = [];
  for (const raw of folded) {
    const baseAnchor = raw.title ? slugify(raw.title) : 'overview';
    const anchor = uniqueAnchor(baseAnchor, used);
    const parts = hardSplit(raw.content, INGEST_CHUNK_CHAR_LIMIT);
    parts.forEach((part, idx) => {
      const partAnchor = idx === 0 ? anchor : `${anchor}-part-${idx + 1}`;
      if (idx > 0) used.add(partAnchor);
      const section: Section = { anchor: partAnchor, content: part };
      if (raw.title !== undefined) section.title = raw.title;
      out.push(section);
    });
  }
  return out;
}

/** D6: an atomic file splits only when it has ≥2 H2 sections AND is large. */
export function shouldSplitAtomic(content: string): boolean {
  if (content.length <= ATOMIC_SPLIT_THRESHOLD) return false;
  const h2Count = content.split('\n').filter(isH2).length;
  return h2Count >= 2;
}
