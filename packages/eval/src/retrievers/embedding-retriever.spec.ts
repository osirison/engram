import { describe, it, expect, vi } from 'vitest';

import { createEmbeddingRetriever, cosineSimilarity } from './embedding-retriever.js';
import type { EvalDocument } from '../types.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical direction vectors', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 when either vector is zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('reuses provided norms', () => {
    expect(cosineSimilarity([3, 4], [3, 4], 5, 5)).toBeCloseTo(1, 10);
  });
});

describe('createEmbeddingRetriever', () => {
  const documents: EvalDocument[] = [
    { id: 'cat', text: 'cat' },
    { id: 'dog', text: 'dog' },
    { id: 'car', text: 'car' },
  ];

  // Deterministic stub: maps known tokens to fixed unit-ish vectors.
  const vectors: Record<string, number[]> = {
    cat: [1, 0, 0],
    dog: [0.9, 0.1, 0],
    car: [0, 0, 1],
  };
  const embed = (text: string): number[] => vectors[text] ?? [0, 0, 0];

  it('embeds documents once during construction', async () => {
    const spy = vi.fn(embed);
    await createEmbeddingRetriever(documents, spy);
    expect(spy).toHaveBeenCalledTimes(documents.length);
  });

  it('ranks documents by cosine similarity to the query', async () => {
    const retriever = await createEmbeddingRetriever(documents, embed);
    const result = await retriever('cat', 3);
    expect(result[0]).toBe('cat');
    expect(result[1]).toBe('dog');
    expect(result).not.toContain('car');
  });

  it('honors the result limit', async () => {
    const retriever = await createEmbeddingRetriever(documents, embed);
    const result = await retriever('cat', 1);
    expect(result).toEqual(['cat']);
  });

  it('drops documents at or below minScore', async () => {
    const retriever = await createEmbeddingRetriever(documents, embed, {
      minScore: 0.999,
    });
    const result = await retriever('cat', 3);
    expect(result).toEqual(['cat']);
  });

  it('supports asynchronous embed functions', async () => {
    const asyncEmbed = (text: string): Promise<number[]> =>
      Promise.resolve(vectors[text] ?? [0, 0, 0]);
    const retriever = await createEmbeddingRetriever(documents, asyncEmbed);
    const result = await retriever('car', 1);
    expect(result).toEqual(['car']);
  });

  it('breaks ties deterministically by id', async () => {
    const tied: EvalDocument[] = [
      { id: 'b', text: 'same' },
      { id: 'a', text: 'same' },
    ];
    const constantEmbed = (): number[] => [1, 1];
    const retriever = await createEmbeddingRetriever(tied, constantEmbed);
    const result = await retriever('same', 2);
    expect(result).toEqual(['a', 'b']);
  });
});
