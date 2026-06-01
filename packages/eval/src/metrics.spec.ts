import { describe, it, expect } from 'vitest';
import { precisionAtK, recallAtK, reciprocalRank, dcgAtK, ndcgAtK, mean } from './metrics.js';

const relevant = new Set(['a', 'b']);

describe('precisionAtK', () => {
  it('counts relevant ids in the top k and normalizes by k', () => {
    expect(precisionAtK(['a', 'x', 'b', 'y'], relevant, 4)).toBe(0.5);
  });

  it('penalizes short result lists by dividing by k', () => {
    expect(precisionAtK(['a'], relevant, 4)).toBe(0.25);
  });

  it('returns 0 for a non-positive k', () => {
    expect(precisionAtK(['a', 'b'], relevant, 0)).toBe(0);
  });
});

describe('recallAtK', () => {
  it('measures the fraction of relevant ids retrieved', () => {
    expect(recallAtK(['a', 'x', 'y'], relevant, 3)).toBe(0.5);
  });

  it('reaches 1 when all relevant ids are within k', () => {
    expect(recallAtK(['a', 'b', 'x'], relevant, 3)).toBe(1);
  });

  it('returns 0 when there are no relevant ids', () => {
    expect(recallAtK(['a'], new Set<string>(), 3)).toBe(0);
  });
});

describe('reciprocalRank', () => {
  it('returns the reciprocal of the first relevant rank', () => {
    expect(reciprocalRank(['x', 'a', 'b'], relevant)).toBeCloseTo(1 / 2);
  });

  it('returns 0 when nothing relevant is retrieved', () => {
    expect(reciprocalRank(['x', 'y'], relevant)).toBe(0);
  });
});

describe('dcgAtK / ndcgAtK', () => {
  it('rewards relevant ids ranked higher', () => {
    const better = dcgAtK(['a', 'x', 'b'], relevant, 3);
    const worse = dcgAtK(['x', 'a', 'b'], relevant, 3);
    expect(better).toBeGreaterThan(worse);
  });

  it('returns a perfect nDCG when relevant ids fill the top ranks', () => {
    expect(ndcgAtK(['a', 'b', 'x'], relevant, 3)).toBeCloseTo(1);
  });

  it('returns 0 nDCG when no relevant ids are retrieved', () => {
    expect(ndcgAtK(['x', 'y'], relevant, 3)).toBe(0);
  });
});

describe('mean', () => {
  it('averages a list of numbers', () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(mean([])).toBe(0);
  });
});
