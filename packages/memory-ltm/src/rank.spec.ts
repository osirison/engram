import { describe, it, expect } from 'vitest';
import { rankResults, DEFAULT_RANKING_WEIGHTS, type RankingWeights } from './rank';
import type { SemanticSearchResult } from './types';

const NOW = new Date('2026-01-01T00:00:00Z');

function makeResult(overrides: {
  id: string;
  score: number;
  createdAt?: Date;
  importance?: number;
}): SemanticSearchResult {
  const { id, score, createdAt = NOW, importance } = overrides;
  return {
    memory: {
      id,
      userId: 'user-1',
      content: `memory ${id}`,
      metadata: importance !== undefined ? { importance } : null,
      tags: [],
      type: 'long-term' as const,
      createdAt,
      updatedAt: createdAt,
      expiresAt: null,
      embedding: [],
    },
    score,
  };
}

describe('rankResults', () => {
  it('returns empty array for empty input', () => {
    expect(rankResults([], DEFAULT_RANKING_WEIGHTS, 30, NOW)).toEqual([]);
  });

  it('throws when all weights are zero', () => {
    const r = makeResult({ id: 'a', score: 0.9 });
    expect(() => rankResults([r], { similarity: 0, recency: 0, importance: 0 }, 30, NOW)).toThrow();
  });

  it('with pure similarity weight, preserves similarity ordering', () => {
    const results = [
      makeResult({ id: 'a', score: 0.6 }),
      makeResult({ id: 'b', score: 0.9 }),
      makeResult({ id: 'c', score: 0.75 }),
    ];
    const weights: RankingWeights = { similarity: 1, recency: 0, importance: 0 };
    const ranked = rankResults(results, weights, 30, NOW);
    expect(ranked.map((r) => r.memory.id)).toEqual(['b', 'c', 'a']);
  });

  it('with pure recency weight, ranks newer memories first', () => {
    const results = [
      makeResult({ id: 'old', score: 0.9, createdAt: new Date('2025-01-01T00:00:00Z') }),
      makeResult({ id: 'new', score: 0.5, createdAt: new Date('2025-12-31T00:00:00Z') }),
    ];
    const weights: RankingWeights = { similarity: 0, recency: 1, importance: 0 };
    const ranked = rankResults(results, weights, 30, NOW);
    expect(ranked[0]?.memory.id).toBe('new');
    expect(ranked[1]?.memory.id).toBe('old');
  });

  it('with pure importance weight, ranks by metadata importance', () => {
    const results = [
      makeResult({ id: 'low', score: 0.9, importance: 0.2 }),
      makeResult({ id: 'high', score: 0.5, importance: 0.9 }),
    ];
    const weights: RankingWeights = { similarity: 0, recency: 0, importance: 1 };
    const ranked = rankResults(results, weights, 30, NOW);
    expect(ranked[0]?.memory.id).toBe('high');
    expect(ranked[1]?.memory.id).toBe('low');
  });

  it('defaults importance to 0.5 when metadata has no importance field', () => {
    const withoutImp = makeResult({ id: 'a', score: 0.8 });
    const withImp = makeResult({ id: 'b', score: 0.8, importance: 0.5 });
    const weights: RankingWeights = { similarity: 0, recency: 0, importance: 1 };
    const ranked = rankResults([withoutImp, withImp], weights, 30, NOW);
    expect(ranked[0]?.score).toBeCloseTo(ranked[1]?.score ?? 0, 10);
  });

  it('normalises weights that do not sum to 1', () => {
    // importance: 0 so only similarity contributes; wSim = 7/7 = 1.0
    const r = makeResult({ id: 'a', score: 0.7, importance: 0 });
    const ranked = rankResults([r], { similarity: 7, recency: 0, importance: 0 }, 30, NOW);
    expect(ranked[0]?.score).toBeCloseTo(0.7, 5);
  });

  it('clamps similarity above 1 to 1', () => {
    const r = makeResult({ id: 'a', score: 1.5 });
    const weights: RankingWeights = { similarity: 1, recency: 0, importance: 0 };
    const ranked = rankResults([r], weights, 30, NOW);
    expect(ranked[0]?.score).toBeCloseTo(1.0, 10);
  });

  it('clamps similarity below 0 to 0', () => {
    const r = makeResult({ id: 'a', score: -0.3 });
    const weights: RankingWeights = { similarity: 1, recency: 0, importance: 0 };
    const ranked = rankResults([r], weights, 30, NOW);
    expect(ranked[0]?.score).toBeCloseTo(0, 10);
  });

  it('recency score at age=0 is 1.0', () => {
    const r = makeResult({ id: 'a', score: 0, createdAt: NOW });
    const weights: RankingWeights = { similarity: 0, recency: 1, importance: 0 };
    const ranked = rankResults([r], weights, 30, NOW);
    expect(ranked[0]?.score).toBeCloseTo(1.0, 10);
  });

  it('recency score at half-life is 0.5', () => {
    const halfLifeDays = 30;
    const createdAt = new Date(NOW.getTime() - halfLifeDays * 86_400_000);
    const r = makeResult({ id: 'a', score: 0, createdAt });
    const weights: RankingWeights = { similarity: 0, recency: 1, importance: 0 };
    const ranked = rankResults([r], weights, halfLifeDays, NOW);
    expect(ranked[0]?.score).toBeCloseTo(0.5, 5);
  });

  it('produces a stable tiebreak by ascending id on equal scores', () => {
    const results = [
      makeResult({ id: 'zzz', score: 0.8, createdAt: NOW }),
      makeResult({ id: 'aaa', score: 0.8, createdAt: NOW }),
      makeResult({ id: 'mmm', score: 0.8, createdAt: NOW }),
    ];
    const weights: RankingWeights = { similarity: 1, recency: 0, importance: 0 };
    const ranked = rankResults(results, weights, 30, NOW);
    expect(ranked.map((r) => r.memory.id)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('does not mutate the input array', () => {
    const results = [makeResult({ id: 'a', score: 0.5 }), makeResult({ id: 'b', score: 0.9 })];
    const copy = [...results];
    rankResults(results, DEFAULT_RANKING_WEIGHTS, 30, NOW);
    expect(results[0]?.memory.id).toBe(copy[0]?.memory.id);
    expect(results[1]?.memory.id).toBe(copy[1]?.memory.id);
  });

  it('blended score combines all three components correctly', () => {
    // similarity=1.0, age=30d (recency=0.5 at half-life=30), importance=0.8
    const createdAt = new Date(NOW.getTime() - 30 * 86_400_000);
    const r = makeResult({ id: 'a', score: 1.0, createdAt, importance: 0.8 });
    const weights: RankingWeights = { similarity: 0.7, recency: 0.2, importance: 0.1 };
    const ranked = rankResults([r], weights, 30, NOW);
    // normalised weights already sum to 1
    const expected = 0.7 * 1.0 + 0.2 * 0.5 + 0.1 * 0.8;
    expect(ranked[0]?.score).toBeCloseTo(expected, 5);
  });
});
