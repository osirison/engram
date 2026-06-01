/**
 * Core data shapes for the retrieval evaluation harness.
 *
 * The harness is intentionally decoupled from the production memory stack: it
 * operates purely on opaque string identifiers so it can score any retriever
 * (keyword, vector, or hybrid) against a labeled dataset.
 */

/** A single document (memory) that can be retrieved. */
export interface EvalDocument {
  /** Stable identifier used to judge relevance. */
  readonly id: string;
  /** Natural-language content used by text-based retrievers. */
  readonly text: string;
}

/** A query paired with the set of document ids considered relevant. */
export interface EvalQuery {
  /** Stable identifier for the query. */
  readonly id: string;
  /** Natural-language query string. */
  readonly query: string;
  /** Document ids that should be retrieved for this query. */
  readonly relevantIds: readonly string[];
}

/** A labeled dataset of documents and queries. */
export interface EvalDataset {
  readonly documents: readonly EvalDocument[];
  readonly queries: readonly EvalQuery[];
}

/**
 * A retriever returns an ordered list of document ids for a query, best first.
 * It may be synchronous or asynchronous so vector backends can be plugged in.
 */
export type Retriever = (
  query: string,
  limit: number
) => readonly string[] | Promise<readonly string[]>;

/** Per-query metric breakdown produced by the harness. */
export interface QueryResult {
  readonly queryId: string;
  readonly query: string;
  readonly retrieved: readonly string[];
  readonly precisionAtK: number;
  readonly recallAtK: number;
  readonly reciprocalRank: number;
  readonly ndcgAtK: number;
}

/** Aggregate report across an entire dataset. */
export interface HarnessReport {
  readonly k: number;
  readonly queryCount: number;
  readonly precisionAtK: number;
  readonly recallAtK: number;
  readonly mrr: number;
  readonly ndcgAtK: number;
  readonly perQuery: readonly QueryResult[];
}
