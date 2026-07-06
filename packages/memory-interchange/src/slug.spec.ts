import { describe, it, expect } from 'vitest';
import { slugify, buildFilename, firstNonEmptyLine, SLUG_MAX_LENGTH } from './slug.js';

describe('firstNonEmptyLine', () => {
  it('skips leading blank/whitespace lines', () => {
    expect(firstNonEmptyLine('\n\n   \nHello world\nsecond')).toBe('Hello world');
  });
  it('returns empty string for all-blank content', () => {
    expect(firstNonEmptyLine('\n   \n\t\n')).toBe('');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('We Chose pgvector Over Qdrant')).toBe('we-chose-pgvector-over-qdrant');
  });

  it('collapses runs of non-alphanumerics into a single hyphen', () => {
    expect(slugify('a  --  b__c!!!d')).toBe('a-b-c-d');
  });

  it('transliterates accented characters to ASCII', () => {
    expect(slugify('Café déjà vu — naïve')).toBe('cafe-deja-vu-naive');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  ...leading and trailing...  ')).toBe('leading-and-trailing');
  });

  it('falls back to "memory" for empty content', () => {
    expect(slugify('')).toBe('memory');
    expect(slugify('   \n  ')).toBe('memory');
  });

  it('falls back to "memory" when content has no ASCII-able alphanumerics', () => {
    expect(slugify('日本語のみ')).toBe('memory');
    expect(slugify('!!! ??? ...')).toBe('memory');
  });

  it('truncates to SLUG_MAX_LENGTH and leaves no trailing hyphen', () => {
    const long = 'word '.repeat(40); // 200 chars of "word word word ..."
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('word-word')).toBe(true);
  });

  it('is deterministic — same input yields identical output', () => {
    const input = 'Deterministic Slug Test #42';
    expect(slugify(input)).toBe(slugify(input));
  });

  it('uses only the first non-empty line', () => {
    expect(slugify('Title line\nbody line that is ignored')).toBe('title-line');
  });
});

describe('buildFilename', () => {
  it('appends the cuid2 id and .md extension', () => {
    expect(buildFilename('cly3k9m0a0000abcd1234', 'We chose pgvector')).toBe(
      'we-chose-pgvector--cly3k9m0a0000abcd1234.md'
    );
  });

  it('is collision-safe: same slug + different ids ⇒ distinct filenames', () => {
    const a = buildFilename('clAAA0000000000000000a', 'Same Title');
    const b = buildFilename('clBBB0000000000000000b', 'Same Title');
    expect(a).not.toBe(b);
    expect(a.startsWith('same-title--')).toBe(true);
    expect(b.startsWith('same-title--')).toBe(true);
  });

  it('still produces a valid filename for empty content', () => {
    expect(buildFilename('clEMPTY000000000000000', '')).toBe('memory--clEMPTY000000000000000.md');
  });
});
