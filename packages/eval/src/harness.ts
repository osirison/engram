import { mean, ndcgAtK, precisionAtK, recallAtK, reciprocalRank } from './metrics.js';
import type { EvalQuery, HarnessReport, QueryResult, Retriever } from './types.js';

/**
 * Run a retriever against a labeled set of queries and aggregate the standard
 * retrieval metrics.
 *
 * @param queries Labeled queries with expected relevant document ids.
 * @param retrieve Retriever under test. Receives the query and a result limit.
 * @param k Cutoff used for precision@k, recall@k, and nDCG@k.
 */
export async function runHarness(
  queries: readonly EvalQuery[],
  retrieve: Retriever,
  k: number
): Promise<HarnessReport> {
  if (k <= 0) {
    throw new Error(`Harness cutoff k must be a positive integer, got ${k}`);
  }

  const perQuery: QueryResult[] = [];

  for (const query of queries) {
    const relevant = new Set(query.relevantIds);
    const retrieved = [...(await retrieve(query.query, k))];

    perQuery.push({
      queryId: query.id,
      query: query.query,
      retrieved,
      precisionAtK: precisionAtK(retrieved, relevant, k),
      recallAtK: recallAtK(retrieved, relevant, k),
      reciprocalRank: reciprocalRank(retrieved, relevant),
      ndcgAtK: ndcgAtK(retrieved, relevant, k),
    });
  }

  return {
    k,
    queryCount: perQuery.length,
    precisionAtK: mean(perQuery.map((result) => result.precisionAtK)),
    recallAtK: mean(perQuery.map((result) => result.recallAtK)),
    mrr: mean(perQuery.map((result) => result.reciprocalRank)),
    ndcgAtK: mean(perQuery.map((result) => result.ndcgAtK)),
    perQuery,
  };
}
