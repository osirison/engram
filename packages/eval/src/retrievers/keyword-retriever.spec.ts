import { describe, it, expect } from 'vitest';
import { createKeywordRetriever, tokenize } from './keyword-retriever.js';
import type { EvalDocument } from '../types.js';

const documents: EvalDocument[] = [
  { id: 'doc-cat', text: 'the cat sat on the warm mat' },
  { id: 'doc-dog', text: 'a loyal dog runs in the green park' },
  { id: 'doc-bird', text: 'a small bird sings in the tall tree' },
];

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric boundaries', () => {
    expect(tokenize('Hello, World! 42')).toEqual(['hello', 'world', '42']);
  });
});

describe('createKeywordRetriever', () => {
  it('ranks documents that share query terms first', () => {
    const retrieve = createKeywordRetriever(documents);
    expect(retrieve('cat on the mat', 3)[0]).toBe('doc-cat');
  });

  it('omits documents with no overlapping terms', () => {
    const retrieve = createKeywordRetriever(documents);
    expect(retrieve('cat', 3)).toEqual(['doc-cat']);
  });

  it('respects the result limit', () => {
    const retrieve = createKeywordRetriever(documents);
    expect(retrieve('the', 2).length).toBeLessThanOrEqual(2);
  });

  it('is deterministic across repeated calls', () => {
    const retrieve = createKeywordRetriever(documents);
    expect(retrieve('the tree park', 3)).toEqual(retrieve('the tree park', 3));
  });
});
