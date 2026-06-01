import type { EvalDocument, Retriever } from '../types.js';

/**
 * An embedding function maps text to a fixed-length dense vector. It may be
 * synchronous or asynchronous so callers can plug in a real provider or a
 * deterministic stub for reproducible evaluation runs.
 */
export type EmbedFunction = (text: string) => readonly number[] | Promise<readonly number[]>;

export interface EmbeddingRetrieverOptions {
  /**
   * Minimum cosine similarity required for a document to be returned. Documents
   * scoring at or below this value are dropped. Defaults to 0.
   */
  minScore?: number;
}

interface IndexedVector {
  readonly id: string;
  readonly vector: readonly number[];
  readonly norm: number;
}

function l2Norm(vector: readonly number[]): number {
  let sum = 0;
  for (const value of vector) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

/**
 * Cosine similarity between two vectors. Returns 0 when either vector has zero
 * magnitude. Assumes equal length; callers index with a single embed function.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
  normA?: number,
  normB?: number
): number {
  const magnitudeA = normA ?? l2Norm(a);
  const magnitudeB = normB ?? l2Norm(b);
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i += 1) {
    dot += (a[i] as number) * (b[i] as number);
  }
  return dot / (magnitudeA * magnitudeB);
}

/**
 * Build an in-memory vector retriever that scores documents by cosine
 * similarity against an embedded query. Documents are embedded once up front,
 * so repeated queries reuse the cached vectors.
 *
 * This is a deterministic, dependency-free way to evaluate embedding quality:
 * inject a real provider for live scoring, or a fixed stub for reproducible
 * tests. The same `embed` function must be used for documents and queries.
 */
export async function createEmbeddingRetriever(
  documents: readonly EvalDocument[],
  embed: EmbedFunction,
  options: EmbeddingRetrieverOptions = {}
): Promise<Retriever> {
  const { minScore = 0 } = options;

  const indexed: IndexedVector[] = await Promise.all(
    documents.map(async (document) => {
      const vector = await embed(document.text);
      return { id: document.id, vector, norm: l2Norm(vector) };
    })
  );

  return async (query: string, limit: number): Promise<string[]> => {
    const queryVector = await embed(query);
    const queryNorm = l2Norm(queryVector);

    return indexed
      .map((document) => ({
        id: document.id,
        score: cosineSimilarity(queryVector, document.vector, queryNorm, document.norm),
      }))
      .filter((entry) => entry.score > minScore)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        // Stable tie-break by id keeps the ranking deterministic.
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .slice(0, limit)
      .map((entry) => entry.id);
  };
}
