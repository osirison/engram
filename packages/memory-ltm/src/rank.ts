import type { SemanticSearchResult } from './types';

export interface RankingWeights {
  /** Weight for raw vector similarity (cosine) score. */
  similarity: number;
  /** Weight for recency decay score. */
  recency: number;
  /** Weight for explicit importance score stored in memory metadata. */
  importance: number;
}

/** Default weights — similarity-dominant, with mild recency boost. */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  similarity: 0.7,
  recency: 0.2,
  importance: 0.1,
};

/**
 * Scoring formula
 * ───────────────
 * finalScore = wSim·clamp(similarity, 0, 1)
 *            + wRec·exp(−ln2 · ageDays / halfLifeDays)
 *            + wImp·importance
 *
 * where:
 *  • similarity    – cosine similarity returned by the vector store ([0, 1])
 *  • ageDays       – (now − memory.createdAt) in calendar days
 *  • halfLifeDays  – configurable half-life (default 30 d); at this age recency = 0.5
 *  • importance    – memory.metadata.importance clamped to [0, 1], default 0.5
 *  • wSim/wRec/wImp – weights normalised so they sum to 1
 */

function recencyScore(createdAt: Date, now: Date, halfLifeDays: number): number {
  const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
  const ageDays = ageMs / 86_400_000;
  return Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
}

function importanceScore(metadata: Record<string, unknown> | null | undefined): number {
  const imp = (metadata as Record<string, unknown> | null | undefined)?.['importance'];
  if (typeof imp === 'number' && Number.isFinite(imp)) {
    return Math.max(0, Math.min(1, imp));
  }
  return 0.5;
}

/**
 * Re-rank semantic search results using a blended similarity + recency +
 * importance score. The returned array is a new array; input is not mutated.
 * The `score` on each result is replaced with the blended value.
 *
 * Ordering is deterministic: ties are broken by ascending memory id so that
 * equal-scoring results produce a stable, reproducible sequence.
 *
 * @param results       Raw hits from the vector store (any order).
 * @param weights       Relative weights (need not sum to 1; they are normalised).
 * @param halfLifeDays  Recency half-life in calendar days (default 30).
 * @param now           Reference time for age calculation (default: Date.now()).
 */
export function rankResults(
  results: SemanticSearchResult[],
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  halfLifeDays = 30,
  now: Date = new Date()
): SemanticSearchResult[] {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    throw new Error('halfLifeDays must be a positive finite number');
  }
  const { similarity, recency, importance } = weights;
  if (
    !Number.isFinite(similarity) ||
    similarity < 0 ||
    !Number.isFinite(recency) ||
    recency < 0 ||
    !Number.isFinite(importance) ||
    importance < 0
  ) {
    throw new Error('Ranking weights must be non-negative finite numbers');
  }
  const total = similarity + recency + importance;
  if (total === 0) {
    throw new Error('Ranking weights must not all be zero');
  }
  const wSim = similarity / total;
  const wRec = recency / total;
  const wImp = importance / total;

  return results
    .map(({ memory, score: similarityScore }) => {
      const blended =
        wSim * Math.max(0, Math.min(1, similarityScore)) +
        wRec * recencyScore(memory.createdAt, now, halfLifeDays) +
        wImp * importanceScore(memory.metadata);
      return { memory, score: blended };
    })
    .sort((a, b) => {
      const diff = b.score - a.score;
      if (Math.abs(diff) > Number.EPSILON) return diff;
      // Stable tiebreak: ascending id (lexicographic, cuid2 is monotonic)
      return a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0;
    });
}
