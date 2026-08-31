import { describe, it, expect } from 'vitest';
import { tokenizeQuery, lexicalRelevance } from './lexical';

describe('tokenizeQuery', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenizeQuery('Postgres, pgvector!')).toEqual(['postgres', 'pgvector']);
  });

  it('keeps identifier- and version-ish tokens usable', () => {
    // Splitting on non-alphanumerics must not destroy the parts of a version
    // or package name that actually discriminate.
    expect(tokenizeQuery('pnpm 11.8.0')).toEqual(['pnpm', '11']);
  });

  it('drops single-character tokens, which match almost everything', () => {
    expect(tokenizeQuery('a b postgres')).toEqual(['postgres']);
  });

  it('removes duplicates so the score denominator is distinct terms', () => {
    expect(tokenizeQuery('cache cache CACHE redis')).toEqual(['cache', 'redis']);
  });

  it('drops stop words that would match every row', () => {
    expect(tokenizeQuery('which package manager do we use')).toEqual(['package', 'manager', 'use']);
  });

  it('falls back to the unfiltered terms when a query is only stop words', () => {
    // Better to attempt a match than to silently retrieve nothing.
    expect(tokenizeQuery('how do we do this')).toEqual(['how', 'do', 'we', 'this']);
  });

  it('caps the term count so a long query cannot build an unbounded query', () => {
    const query = Array.from({ length: 60 }, (_, i) => `term${i}`).join(' ');
    expect(tokenizeQuery(query)).toHaveLength(24);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   \n\t '],
    ['punctuation only', '!!! ??? ---'],
    ['null', null],
    ['undefined', undefined],
  ])('returns no terms for %s', (_label, input) => {
    expect(tokenizeQuery(input as string)).toEqual([]);
  });
});

describe('lexicalRelevance', () => {
  it('scores the fraction of distinct query terms present', () => {
    expect(lexicalRelevance('use pnpm in this repo', ['pnpm', 'repo'])).toBe(1);
    expect(lexicalRelevance('use pnpm in this repo', ['pnpm', 'yarn'])).toBe(0.5);
    expect(lexicalRelevance('use pnpm in this repo', ['yarn', 'npm2'])).toBe(0);
  });

  it('is case-insensitive in both directions', () => {
    expect(lexicalRelevance('Use PNPM Here', ['pnpm'])).toBe(1);
  });

  it('does not reward repetition — it measures query coverage, not frequency', () => {
    expect(lexicalRelevance('pnpm pnpm pnpm pnpm', ['pnpm'])).toBe(1);
    expect(lexicalRelevance('pnpm pnpm pnpm', ['pnpm', 'docker'])).toBe(0.5);
  });

  it('matches substrings, mirroring the SQL ILIKE %term% that selected the row', () => {
    // If this diverged from the query, a score could claim a match the SQL
    // never made (or miss one it did).
    expect(lexicalRelevance('reindexing the store', ['index'])).toBe(1);
  });

  it('always stays within [0, 1] so it can occupy the similarity slot', () => {
    const score = lexicalRelevance('alpha beta gamma', ['alpha', 'beta', 'gamma']);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it.each([
    ['no terms', 'anything at all', []],
    ['empty content', '', ['pnpm']],
    ['null content', null, ['pnpm']],
    ['undefined content', undefined, ['pnpm']],
  ])('returns 0 for %s', (_label, content, terms) => {
    expect(lexicalRelevance(content as string, terms as string[])).toBe(0);
  });
});
