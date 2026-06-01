import { describe, it, expect } from 'vitest';
import { runHarness } from './harness.js';
import { createKeywordRetriever } from './retrievers/keyword-retriever.js';
import { recallFixtures } from './fixtures/recall-fixtures.js';
import type { EvalQuery, Retriever } from './types.js';

describe('runHarness', () => {
  it('rejects a non-positive cutoff', async () => {
    await expect(runHarness([], () => [], 0)).rejects.toThrow(/positive integer/);
  });

  it('aggregates per-query metrics into dataset means', async () => {
    const queries: EvalQuery[] = [
      { id: 'q1', query: 'first', relevantIds: ['a'] },
      { id: 'q2', query: 'second', relevantIds: ['b'] },
    ];

    const perfect: Retriever = (query) => (query === 'first' ? ['a'] : ['b']);
    const report = await runHarness(queries, perfect, 3);

    expect(report.queryCount).toBe(2);
    expect(report.mrr).toBeCloseTo(1);
    expect(report.ndcgAtK).toBeCloseTo(1);
    expect(report.perQuery).toHaveLength(2);
  });

  it('supports asynchronous retrievers', async () => {
    const queries: EvalQuery[] = [{ id: 'q1', query: 'first', relevantIds: ['a'] }];

    const asyncRetriever: Retriever = (_query, limit) => Promise.resolve(['a'].slice(0, limit));

    const report = await runHarness(queries, asyncRetriever, 3);
    expect(report.precisionAtK).toBeCloseTo(1 / 3);
    expect(report.recallAtK).toBeCloseTo(1);
  });

  it('produces a meaningful score for the keyword baseline on fixtures', async () => {
    const retriever = createKeywordRetriever(recallFixtures.documents);
    const report = await runHarness(recallFixtures.queries, retriever, 5);

    // The baseline should comfortably retrieve relevant memories for this
    // deterministic dataset; guard against regressions in the retriever.
    expect(report.queryCount).toBe(recallFixtures.queries.length);
    expect(report.mrr).toBeGreaterThan(0.8);
    expect(report.ndcgAtK).toBeGreaterThan(0.7);
    expect(report.recallAtK).toBeGreaterThan(0.7);
  });
});
