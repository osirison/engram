import { Injectable, Logger } from '@nestjs/common';
import type { LtmMemory, SemanticSearchResult } from '../types';
import { reciprocalRankFusion } from '@engram/eval';

/**
 * Transient hybrid retrieval kernel.
 *
 * Used by profile-memory and profile-lite to provide intelligent lexical
 * + semantic ranking without an external vector store. The retriever
 * holds an in-memory postings index and a normalized vector array; both
 * are rebuilt from the input `LtmMemory[]` passed to {@link index}.
 *
 * Ranking follows the same Reciprocal Rank Fusion (RRF) recipe as the
 * eval harness retriever so that the behaviour matches the production
 * fusion strategy byte-for-byte.
 */
@Injectable()
export class HybridTransientRetriever {
  private readonly logger = new Logger(HybridTransientRetriever.name);

  private memories: LtmMemory[] = [];
  /** token -> list of memory ids (in postings order) */
  private postings: Map<string, string[]> = new Map();
  /** memory id -> normalized vector */
  private vectors: Map<string, number[]> = new Map();
  /** memory id -> magnitude of the original vector, for cosine re-use */
  private magnitudes: Map<string, number> = new Map();

  /**
   * Rebuild the in-memory index from the supplied memories. The retriever
   * is intentionally stateless across calls so that consumers can call
   * `index()` whenever the underlying data changes.
   */
  index(memories: LtmMemory[]): void {
    this.memories = [...memories];
    this.postings.clear();
    this.vectors.clear();
    this.magnitudes.clear();

    for (const memory of this.memories) {
      // Lexical postings: tokenize on non-word boundaries, lowercase,
      // filter short tokens, dedupe per memory while preserving first
      // occurrence order.
      const seenInDoc = new Set<string>();
      const tokens = this.tokenize(memory.content);
      for (const token of tokens) {
        if (seenInDoc.has(token)) continue;
        seenInDoc.add(token);
        const list = this.postings.get(token);
        if (list) {
          list.push(memory.id);
        } else {
          this.postings.set(token, [memory.id]);
        }
      }

      // Vector index: only when the memory actually has an embedding.
      if (memory.embedding && memory.embedding.length > 0) {
        const norm = this.normalize(memory.embedding);
        this.vectors.set(memory.id, norm.normalized);
        this.magnitudes.set(memory.id, norm.magnitude);
      }
    }
    this.logger.debug(
      `HybridTransientRetriever indexed ${this.memories.length} memories ` +
        `(${this.postings.size} tokens, ${this.vectors.size} vectors)`
    );
  }

  /**
   * Run a hybrid search.
   *
   *  - `query` is tokenized and matched against the postings index.
   *  - `embedding` (when supplied) is matched against the vector index
   *    using cosine similarity.
   *  - The two rankings are fused with RRF; the top `topK` ids are
   *    returned along with a blended score in [0, 1].
   *
   * If neither input yields candidates the result is empty.
   */
  search(query: string, embedding?: number[], topK: number = 10): SemanticSearchResult[] {
    if (this.memories.length === 0) {
      return [];
    }
    if (topK <= 0) {
      return [];
    }
    const limit = Math.max(1, Math.min(topK, this.memories.length));

    const lexicalIds = this.lexicalSearch(query);
    const semanticIds = this.semanticSearch(embedding);

    if (lexicalIds.length === 0 && semanticIds.length === 0) {
      return [];
    }

    const fused = reciprocalRankFusion([lexicalIds, semanticIds], {
      k: 60,
      weights: [1, 1],
      limit,
    });

    const memoryById = new Map(this.memories.map((m) => [m.id, m]));
    const out: SemanticSearchResult[] = [];
    for (const id of fused) {
      const memory = memoryById.get(id);
      if (!memory) continue;
      out.push({ memory, score: this.computeBlendedScore(id, lexicalIds, semanticIds) });
    }
    return out;
  }

  /**
   * Number of memories currently indexed. Useful for tests.
   */
  size(): number {
    return this.memories.length;
  }

  // ── private helpers ─────────────────────────────────────────────────────

  private lexicalSearch(query: string): string[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) {
      return [];
    }
    // Score each memory by the number of unique matching tokens, then
    // break ties by id so the ranking is deterministic.
    const scores = new Map<string, number>();
    for (const token of tokens) {
      const postings = this.postings.get(token);
      if (!postings) continue;
      for (const id of postings) {
        scores.set(id, (scores.get(id) ?? 0) + 1);
      }
    }
    return [...scores.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      })
      .map(([id]) => id);
  }

  private semanticSearch(embedding: number[] | undefined): string[] {
    if (!embedding || embedding.length === 0) {
      return [];
    }
    if (this.vectors.size === 0) {
      return [];
    }
    const { normalized: queryNorm, magnitude: queryMag } = this.normalize(embedding);
    if (queryNorm.every((v) => v === 0) || queryMag === 0) {
      return [];
    }
    const scored: Array<{ id: string; score: number }> = [];
    for (const [id, vec] of this.vectors.entries()) {
      const dot = this.dotProduct(queryNorm, vec);
      const denom = queryMag * (this.magnitudes.get(id) ?? 0);
      if (denom === 0) continue;
      const cosine = dot / denom;
      scored.push({ id, score: cosine });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return scored.map((s) => s.id);
  }

  /**
   * Compute a coarse blended score in [0, 1] for the result row. We
   * expose it for callers that need a single comparable number; the RRF
   * ordering itself is the source of truth for the final ranking.
   */
  private computeBlendedScore(id: string, lexicalIds: string[], semanticIds: string[]): number {
    const lexRank = lexicalIds.indexOf(id);
    const semRank = semanticIds.indexOf(id);
    let score = 0;
    let parts = 0;
    if (lexRank >= 0) {
      score += 1 / (60 + lexRank);
      parts += 1;
    }
    if (semRank >= 0) {
      score += 1 / (60 + semRank);
      parts += 1;
    }
    if (parts === 0) return 0;
    // Normalize into [0, 1] by the maximum achievable contribution
    // (2 * 1 / 60) so the value is intuitive at a glance.
    return score / (2 / 60);
  }

  private tokenize(text: string): string[] {
    if (!text) return [];
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((t) => t.length >= 2);
  }

  private normalize(vector: number[]): { normalized: number[]; magnitude: number } {
    let magnitude = 0;
    for (const v of vector) {
      magnitude += v * v;
    }
    magnitude = Math.sqrt(magnitude);
    if (magnitude === 0) {
      return { normalized: [...vector], magnitude: 0 };
    }
    const normalized = vector.map((v) => v / magnitude);
    return { normalized, magnitude };
  }

  private dotProduct(a: number[], b: number[]): number {
    const length = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      sum += av * bv;
    }
    return sum;
  }
}
