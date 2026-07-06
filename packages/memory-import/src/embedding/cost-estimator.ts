/**
 * Dry-run embedding cost estimator (WP4 D8/G7). Pure function: no NestJS, no I/O.
 *
 * Makes the first bulk import cheap + predictable by estimating how many
 * embedding API calls / tokens / USD a batch will cost BEFORE embedding. The
 * caller passes only the contents of facts that will be newly embedded (already
 * deduped against the ledger); a `disabled` embedding provider is modelled by
 * the caller passing `[]`, which yields an all-zero estimate.
 *
 * Token estimate ≈ ceil(chars / 4) per content (rough OpenAI heuristic).
 */

/** USD per 1,000,000 tokens, from OpenAI embedding model rates. */
export const EMBEDDING_USD_PER_MILLION: Record<string, number> = {
  'text-embedding-3-small': 0.02,
  'text-embedding-3-large': 0.13,
};

/** Model used when the caller does not specify one. */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export interface CostEstimate {
  /** Number of embedding calls (one per content). */
  calls: number;
  /** Sum of ceil(len/4) across all contents. */
  approxTokens: number;
  /** approxTokens / 1e6 * rate, rounded to 6 decimals. */
  approxUsd: number;
  /** Model the estimate was computed for. */
  model: string;
}

function approxTokensFor(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * Estimate the embedding cost over the facts that WILL be newly embedded.
 *
 * @param contents  Content strings of the new facts (pass `[]` for disabled/no-op).
 * @param opts.model         Embedding model id (default `text-embedding-3-small`).
 * @param opts.usdPerMillion Explicit USD-per-million override; wins over the model table.
 */
export function estimateEmbeddingCost(
  contents: string[],
  opts?: { model?: string; usdPerMillion?: number }
): CostEstimate {
  const model = opts?.model ?? DEFAULT_EMBEDDING_MODEL;
  const rate =
    opts?.usdPerMillion ??
    EMBEDDING_USD_PER_MILLION[model] ??
    EMBEDDING_USD_PER_MILLION[DEFAULT_EMBEDDING_MODEL] ??
    0.02;

  let approxTokens = 0;
  for (const content of contents) {
    approxTokens += approxTokensFor(content);
  }

  const rawUsd = (approxTokens / 1_000_000) * rate;
  const approxUsd = Math.round(rawUsd * 1_000_000) / 1_000_000;

  return {
    calls: contents.length,
    approxTokens,
    approxUsd,
    model,
  };
}
