import { describe, it, expect, vi } from 'vitest';

import { reciprocalRankFusion, createFusionRetriever, DEFAULT_RRF_K } from './fusion-retriever.js';

describe('reciprocalRankFusion', () => {
  it('returns an empty list for no rankings', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it('preserves a single ranking order', () => {
    expect(reciprocalRankFusion([['a', 'b', 'c']])).toEqual(['a', 'b', 'c']);
  });

  it('rewards documents ranked highly across multiple lists', () => {
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['b', 'a', 'd'],
    ]);
    // `a` and `b` both appear near the top of both lists; `a` is rank 0 then 1,
    // `b` is rank 1 then 0 — equal scores, tie broken by best rank (both 0).
    expect(fused.slice(0, 2).sort()).toEqual(['a', 'b']);
    expect(fused).toContain('c');
    expect(fused).toContain('d');
  });

  it('ranks a consensus document above single-list documents', () => {
    const fused = reciprocalRankFusion([
      ['x', 'shared'],
      ['y', 'shared'],
    ]);
    expect(fused[0]).toBe('shared');
  });

  it('applies per-ranking weights', () => {
    const unweighted = reciprocalRankFusion([['a'], ['b']]);
    // Tie broken lexicographically without weights.
    expect(unweighted[0]).toBe('a');

    const weighted = reciprocalRankFusion([['a'], ['b']], {
      weights: [1, 5],
    });
    expect(weighted[0]).toBe('b');
  });

  it('honors a limit', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c', 'd']], { limit: 2 });
    expect(fused).toEqual(['a', 'b']);
  });

  it('uses the standard k constant by default', () => {
    expect(DEFAULT_RRF_K).toBe(60);
  });

  it('rejects a non-positive k', () => {
    expect(() => reciprocalRankFusion([['a']], { k: 0 })).toThrow(/k must be positive/);
  });

  it('rejects mismatched weights', () => {
    expect(() => reciprocalRankFusion([['a'], ['b']], { weights: [1] })).toThrow(/weights length/);
  });
});

describe('createFusionRetriever', () => {
  it('requires at least one retriever', () => {
    expect(() => createFusionRetriever([])).toThrow(/at least one retriever/);
  });

  it('fuses results from multiple retrievers', async () => {
    const keyword = vi.fn().mockResolvedValue(['a', 'b', 'c']);
    const vector = vi.fn().mockResolvedValue(['b', 'a', 'd']);

    const fusion = createFusionRetriever([keyword, vector]);
    const result = await fusion('query', 3);

    expect(keyword).toHaveBeenCalledWith('query', 3);
    expect(vector).toHaveBeenCalledWith('query', 3);
    expect(result).toHaveLength(3);
    expect(result.slice(0, 2).sort()).toEqual(['a', 'b']);
  });

  it('requests candidateLimit candidates from each retriever', async () => {
    const retriever = vi.fn().mockResolvedValue(['a', 'b', 'c', 'd', 'e']);
    const fusion = createFusionRetriever([retriever], { candidateLimit: 5 });

    const result = await fusion('query', 2);

    expect(retriever).toHaveBeenCalledWith('query', 5);
    expect(result).toEqual(['a', 'b']);
  });

  it('supports synchronous retrievers', async () => {
    const sync = (_query: string, limit: number): string[] => ['a', 'b', 'c'].slice(0, limit);
    const fusion = createFusionRetriever([sync]);

    await expect(fusion('q', 2)).resolves.toEqual(['a', 'b']);
  });
});
