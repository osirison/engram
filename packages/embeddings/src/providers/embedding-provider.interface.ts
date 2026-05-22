import type { EmbeddingModel } from '../types.js';

export interface EmbeddingProvider {
  generate(text: string, model: EmbeddingModel): Promise<number[] | null>;
}
