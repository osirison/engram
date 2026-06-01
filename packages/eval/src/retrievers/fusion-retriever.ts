import type { Retriever } from '../types.js';

/** Standard Reciprocal Rank Fusion damping constant (Cormack et al., 2009). */
export const DEFAULT_RRF_K = 60;

export interface ReciprocalRankFusionOptions {
  /**
   * Damping constant that controls how quickly a document's contribution
   * decays with rank. Larger values flatten the curve. Defaults to
   * {@link DEFAULT_RRF_K}.
   */
  k?: number;
  /** Optional per-ranking weights, aligned by index with `rankings`. */
  weights?: readonly number[];
  /** Truncate the fused output to this many ids. Defaults to no limit. */
  limit?: number;
}

interface FusionEntry {
  readonly id: string;
  score: number;
  bestRank: number;
}

/**
 * Fuse multiple ranked id lists into a single ranking via Reciprocal Rank
 * Fusion (RRF). Each ranking contributes `weight / (k + rank)` to every id it
 * contains (rank is 0-based). Deterministic: ties break by best observed rank,
 * then lexicographically by id.
 */
export function reciprocalRankFusion(
  rankings: ReadonlyArray<readonly string[]>,
  options: ReciprocalRankFusionOptions = {}
): string[] {
  const { k = DEFAULT_RRF_K, weights, limit } = options;

  if (k <= 0) {
    throw new Error('reciprocalRankFusion: k must be positive');
  }
  if (weights && weights.length !== rankings.length) {
    throw new Error('reciprocalRankFusion: weights length must match rankings length');
  }

  const entries = new Map<string, FusionEntry>();

  rankings.forEach((ranking, rankingIndex) => {
    const weight = weights ? (weights[rankingIndex] ?? 1) : 1;
    ranking.forEach((id, rank) => {
      const contribution = weight / (k + rank);
      const existing = entries.get(id);
      if (existing) {
        existing.score += contribution;
        if (rank < existing.bestRank) {
          existing.bestRank = rank;
        }
      } else {
        entries.set(id, { id, score: contribution, bestRank: rank });
      }
    });
  });

  const fused = [...entries.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.bestRank !== b.bestRank) {
      return a.bestRank - b.bestRank;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const ids = fused.map((entry) => entry.id);
  return limit !== undefined ? ids.slice(0, limit) : ids;
}

export interface FusionRetrieverOptions extends ReciprocalRankFusionOptions {
  /**
   * Number of candidates to request from each underlying retriever before
   * fusion. Defaults to the harness `limit` passed at query time.
   */
  candidateLimit?: number;
}

/**
 * Build a {@link Retriever} that queries several retrievers in parallel and
 * fuses their rankings with {@link reciprocalRankFusion}. Useful for combining
 * a keyword retriever with a vector retriever into a hybrid ranking.
 */
export function createFusionRetriever(
  retrievers: readonly Retriever[],
  options: FusionRetrieverOptions = {}
): Retriever {
  if (retrievers.length === 0) {
    throw new Error('createFusionRetriever requires at least one retriever');
  }

  const { candidateLimit, k, weights } = options;

  return async (query: string, limit: number): Promise<string[]> => {
    const perRetrieverLimit = candidateLimit ?? limit;
    const rankings = await Promise.all(
      retrievers.map(async (retriever) => {
        const result = await retriever(query, perRetrieverLimit);
        return [...result];
      })
    );

    return reciprocalRankFusion(rankings, { k, weights, limit });
  };
}
