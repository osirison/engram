import { describe, it, expect } from 'vitest';
import {
  chunkByHeadings,
  shouldSplitAtomic,
  INGEST_CHUNK_CHAR_LIMIT,
  MIN_SECTION_CHARS,
} from './chunk.js';

const para = (n: number, filler = 'x'): string => filler.repeat(n);

describe('chunkByHeadings', () => {
  it('returns a single overview section for a document with no H2', () => {
    const sections = chunkByHeadings('Just a preamble with no headings.');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.anchor).toBe('overview');
    expect(sections[0]?.title).toBeUndefined();
  });

  it('splits at H2 boundaries and keeps H3 children with their parent', () => {
    const doc = [
      `Intro preamble long enough to stand alone ${para(MIN_SECTION_CHARS)}`,
      '',
      '## Commands',
      `command detail ${para(MIN_SECTION_CHARS)}`,
      '### Sub',
      'sub detail',
      '',
      '## Architecture',
      `arch detail ${para(MIN_SECTION_CHARS)}`,
    ].join('\n');
    const sections = chunkByHeadings(doc);
    expect(sections.map((s) => s.anchor)).toEqual(['overview', 'commands', 'architecture']);
    expect(sections[1]?.title).toBe('Commands');
    expect(sections[1]?.content).toContain('### Sub');
  });

  it('folds a fragment section (<MIN_SECTION_CHARS) into the following section', () => {
    const doc = ['## Tiny', 'short', '## Big', `big body ${para(MIN_SECTION_CHARS)}`].join('\n');
    const sections = chunkByHeadings(doc);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.anchor).toBe('big');
    expect(sections[0]?.content).toContain('## Tiny');
    expect(sections[0]?.content).toContain('## Big');
  });

  it('hard-splits an oversized section with -part-N anchors', () => {
    const big = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${para(1000)}`).join('\n\n');
    const doc = `## Huge\n${big}`;
    const sections = chunkByHeadings(doc);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0]?.anchor).toBe('huge');
    expect(sections[1]?.anchor).toBe('huge-part-2');
    for (const s of sections) expect(s.content.length).toBeLessThanOrEqual(INGEST_CHUNK_CHAR_LIMIT);
  });

  it('disambiguates duplicate headings with numeric suffixes', () => {
    const doc = [`## Setup`, para(MIN_SECTION_CHARS), `## Setup`, para(MIN_SECTION_CHARS)].join(
      '\n'
    );
    const sections = chunkByHeadings(doc);
    expect(sections.map((s) => s.anchor)).toEqual(['setup', 'setup-2']);
  });
});

describe('shouldSplitAtomic', () => {
  it('is false for a small file even with multiple H2s', () => {
    expect(shouldSplitAtomic('## A\nx\n## B\ny')).toBe(false);
  });

  it('is false for a large file with fewer than 2 H2s', () => {
    expect(shouldSplitAtomic(`## Only\n${para(3000)}`)).toBe(false);
  });

  it('is true for a large file with ≥2 H2 sections', () => {
    expect(shouldSplitAtomic(`## A\n${para(1500)}\n## B\n${para(1500)}`)).toBe(true);
  });
});
