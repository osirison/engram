import type { EvalDocument, Retriever } from '../types.js';

/**
 * Split text into lowercased alphanumeric tokens. Deterministic and dependency
 * free so evaluation runs are fully reproducible.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

interface IndexedDocument {
  readonly id: string;
  readonly termFrequencies: ReadonlyMap<string, number>;
}

/**
 * A deterministic TF-IDF keyword retriever.
 *
 * This is the offline baseline retriever for the evaluation harness. It does
 * not depend on embeddings or any external service, so it produces stable
 * metrics that future vector/hybrid retrievers can be compared against.
 */
export function createKeywordRetriever(documents: readonly EvalDocument[]): Retriever {
  const indexed: IndexedDocument[] = [];
  const documentFrequency = new Map<string, number>();

  for (const document of documents) {
    const termFrequencies = new Map<string, number>();
    for (const token of tokenize(document.text)) {
      termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1);
    }

    for (const term of termFrequencies.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }

    indexed.push({ id: document.id, termFrequencies });
  }

  const totalDocuments = indexed.length;

  const idf = (term: string): number => {
    const df = documentFrequency.get(term) ?? 0;
    if (df === 0) {
      return 0;
    }

    // Smoothed inverse document frequency keeps weights positive.
    return Math.log((totalDocuments + 1) / (df + 1)) + 1;
  };

  return (query: string, limit: number): string[] => {
    const queryTerms = tokenize(query);

    const scored = indexed.map((document) => {
      let score = 0;
      for (const term of queryTerms) {
        const tf = document.termFrequencies.get(term) ?? 0;
        if (tf > 0) {
          score += tf * idf(term);
        }
      }

      return { id: document.id, score };
    });

    return scored
      .filter((entry) => entry.score > 0)
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
