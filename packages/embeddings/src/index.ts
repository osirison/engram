export { EmbeddingsModule } from './embeddings.module.js';
export { EmbeddingsService } from './embeddings.service.js';
export { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider.js';
export type { EmbeddingProvider } from './providers/embedding-provider.interface.js';
export type {
  EmbeddingModel,
  EmbeddingResult,
  GenerateEmbeddingInput,
} from './types.js';
export {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  MODEL_DIMENSIONS,
  EMBEDDING_CACHE_TTL,
  MAX_TEXT_LENGTH,
  EmbeddingValidationError,
  EmbeddingApiError,
} from './types.js';
