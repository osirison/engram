/**
 * Ranking metrics for retrieval evaluation.
 *
 * All functions use binary relevance: a retrieved id is either relevant
 * (present in the relevant set) or not. Identifiers, not positions, are
 * compared, so ranking order is the only thing that matters.
 */

/**
 * Precision@k: fraction of the top-k retrieved ids that are relevant.
 * Normalized by `k` (not by the number retrieved) so short result lists are
 * penalized, matching standard IR conventions.
 */
export function precisionAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number
): number {
  if (k <= 0) {
    return 0;
  }

  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const id of topK) {
    if (relevant.has(id)) {
      hits += 1;
    }
  }

  return hits / k;
}

/**
 * Recall@k: fraction of all relevant ids that appear in the top-k results.
 */
export function recallAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number
): number {
  if (relevant.size === 0 || k <= 0) {
    return 0;
  }

  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const id of topK) {
    if (relevant.has(id)) {
      hits += 1;
    }
  }

  return hits / relevant.size;
}

/**
 * Reciprocal rank: 1 / (rank of the first relevant id), or 0 if none match.
 * Averaging this across queries yields Mean Reciprocal Rank (MRR).
 */
export function reciprocalRank(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>
): number {
  for (let i = 0; i < retrieved.length; i += 1) {
    const id = retrieved[i];
    if (id !== undefined && relevant.has(id)) {
      return 1 / (i + 1);
    }
  }

  return 0;
}

/**
 * Discounted Cumulative Gain at k for binary relevance.
 */
export function dcgAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number
): number {
  const limit = Math.min(k, retrieved.length);
  let dcg = 0;
  for (let i = 0; i < limit; i += 1) {
    const id = retrieved[i];
    if (id !== undefined && relevant.has(id)) {
      // log2(i + 2) because positions are 1-indexed in the DCG formula.
      dcg += 1 / Math.log2(i + 2);
    }
  }

  return dcg;
}

/**
 * Normalized DCG at k: DCG divided by the ideal DCG, yielding a value in
 * [0, 1] where 1 means every relevant id was ranked ahead of irrelevant ones.
 */
export function ndcgAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number
): number {
  const dcg = dcgAtK(retrieved, relevant, k);
  const idealHits = Math.min(relevant.size, k);

  let idcg = 0;
  for (let i = 0; i < idealHits; i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Mean of a list of numbers, returning 0 for an empty list.
 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  let total = 0;
  for (const value of values) {
    total += value;
  }

  return total / values.length;
}
