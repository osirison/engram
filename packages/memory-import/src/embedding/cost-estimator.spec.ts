import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_USD_PER_MILLION,
  estimateEmbeddingCost,
} from './cost-estimator.js';

describe('estimateEmbeddingCost', () => {
  it('computes calls, approxTokens (sum ceil(len/4)) and approxUsd for a known set', () => {
    // lengths: 8 -> 2, 10 -> 3, 3 -> 1 => 6 tokens total
    const contents = ['aaaaaaaa', 'bbbbbbbbbb', 'ccc'];
    const est = estimateEmbeddingCost(contents);

    expect(est.calls).toBe(3);
    expect(est.approxTokens).toBe(2 + 3 + 1);
    expect(est.model).toBe(DEFAULT_EMBEDDING_MODEL);
    // 6 / 1e6 * 0.02 = 1.2e-7 -> rounded to 6 decimals = 0
    expect(est.approxUsd).toBe(0);
  });

  it('rounds a larger token count to a non-zero USD value', () => {
    // 100_000 chars -> 25_000 tokens
    const contents = ['x'.repeat(100_000)];
    const est = estimateEmbeddingCost(contents);

    expect(est.calls).toBe(1);
    expect(est.approxTokens).toBe(25_000);
    // 25_000 / 1e6 * 0.02 = 0.0005
    expect(est.approxUsd).toBe(0.0005);
  });

  it('uses the large-model rate when the large model is selected', () => {
    const contents = ['x'.repeat(100_000)]; // 25_000 tokens
    const small = estimateEmbeddingCost(contents, { model: 'text-embedding-3-small' });
    const large = estimateEmbeddingCost(contents, { model: 'text-embedding-3-large' });

    expect(large.model).toBe('text-embedding-3-large');
    expect(large.approxTokens).toBe(small.approxTokens);
    // 25_000 / 1e6 * 0.13 = 0.00325
    expect(large.approxUsd).toBe(0.00325);
    expect(large.approxUsd).toBeGreaterThan(small.approxUsd);
    expect(large.approxUsd / small.approxUsd).toBeCloseTo(0.13 / 0.02, 6);
  });

  it('returns all zeros for empty input (disabled provider path)', () => {
    const est = estimateEmbeddingCost([]);

    expect(est.calls).toBe(0);
    expect(est.approxTokens).toBe(0);
    expect(est.approxUsd).toBe(0);
    expect(est.model).toBe(DEFAULT_EMBEDDING_MODEL);
  });

  it('honours a custom usdPerMillion override over the model table', () => {
    const contents = ['x'.repeat(100_000)]; // 25_000 tokens
    const est = estimateEmbeddingCost(contents, {
      model: 'text-embedding-3-small',
      usdPerMillion: 1,
    });

    // 25_000 / 1e6 * 1 = 0.025
    expect(est.approxUsd).toBe(0.025);
    expect(est.model).toBe('text-embedding-3-small');
  });

  it('falls back to the small rate for an unknown model', () => {
    const contents = ['x'.repeat(100_000)]; // 25_000 tokens
    const est = estimateEmbeddingCost(contents, { model: 'made-up-model' });

    expect(est.model).toBe('made-up-model');
    // uses small rate 0.02 -> 0.0005
    expect(est.approxUsd).toBe(0.0005);
    expect(est.approxUsd).toBe(
      estimateEmbeddingCost(contents, { model: DEFAULT_EMBEDDING_MODEL }).approxUsd
    );
  });

  it('exposes the documented model rate table', () => {
    expect(EMBEDDING_USD_PER_MILLION['text-embedding-3-small']).toBe(0.02);
    expect(EMBEDDING_USD_PER_MILLION['text-embedding-3-large']).toBe(0.13);
  });
});
