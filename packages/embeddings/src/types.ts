import { z } from 'zod';

/**
 * Embedding model identifier. Open-ended: any model id the configured
 * provider understands (e.g. Ollama model names, OpenAI model ids).
 */
export type EmbeddingModel = string;

/**
 * Dimensions produced by well-known models. Models absent from this map still
 * work — dimensionality then flows from the provider's actual output vector.
 */
export const MODEL_DIMENSIONS: Record<string, number> = {
  // Local models (Ollama)
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'bge-m3': 1024,
  // Deterministic hash scaffold (EMBEDDING_PROVIDER=local, CI/testing)
  'local-hash': 1536,
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
};

/** Well-known model ids (compat export; no longer a closed set). */
export const EMBEDDING_MODELS: readonly string[] = Object.keys(MODEL_DIMENSIONS);

/** Maximum text length accepted for embedding (aligned with OpenAI token limits). */
export const MAX_TEXT_LENGTH = 8191;

/** Options accepted by EmbeddingsService.generate() — model is optional. */
export const generateEmbeddingSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must not be empty')
    .max(MAX_TEXT_LENGTH, `Text cannot exceed ${MAX_TEXT_LENGTH} characters`),
  model: z.string().min(1, 'Model must not be empty').max(200).optional(),
});

/**
 * Input type for EmbeddingsService.generate().
 * `model` is optional — when omitted, the service falls back to the resolved
 * runtime model (see resolveEmbeddingRuntime in embedding-runtime.ts).
 */
export type GenerateEmbeddingInput = z.input<typeof generateEmbeddingSchema>;

/** Result returned by EmbeddingsService.generate(). */
export interface EmbeddingResult {
  embedding: number[];
  model: EmbeddingModel;
  cached: boolean;
}

/** Custom errors thrown by EmbeddingsService. */
export class EmbeddingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingValidationError';
  }
}

export class EmbeddingApiError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'EmbeddingApiError';
  }
}
