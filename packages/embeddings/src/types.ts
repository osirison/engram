import { z } from 'zod';

/**
 * Supported embedding models.
 * text-embedding-3-small: 1536 dimensions, cost-efficient, recommended default.
 * text-embedding-3-large: 3072 dimensions, higher accuracy.
 */
export const EMBEDDING_MODELS = ['text-embedding-3-small', 'text-embedding-3-large'] as const;
export type EmbeddingModel = (typeof EMBEDDING_MODELS)[number];

/** Dimensions produced by each model. */
export const MODEL_DIMENSIONS: Record<EmbeddingModel, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
};

/** Default cache TTL: 30 days in seconds. */
export const EMBEDDING_CACHE_TTL = 60 * 60 * 24 * 30;

/** Default embedding model. */
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModel = 'text-embedding-3-small';

/** Maximum text length accepted for embedding (aligned with OpenAI token limits). */
export const MAX_TEXT_LENGTH = 8191;

/** Options accepted by EmbeddingsService.generate() — model is optional. */
export const generateEmbeddingSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must not be empty')
    .max(MAX_TEXT_LENGTH, `Text cannot exceed ${MAX_TEXT_LENGTH} characters`),
  model: z.enum(EMBEDDING_MODELS).optional().default(DEFAULT_EMBEDDING_MODEL),
});

/**
 * Input type for EmbeddingsService.generate().
 * Uses z.input so that `model` is optional (a default is applied by the schema).
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
