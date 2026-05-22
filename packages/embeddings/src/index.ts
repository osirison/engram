export { EmbeddingsModule } from './embeddings.module.js';
export { EmbeddingsService } from './embeddings.service.js';
export { DisabledEmbeddingProvider } from './providers/disabled-embedding.provider.js';
export { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider.js';
export type { EmbeddingProvider } from './providers/embedding-provider.interface.js';
export {
  EMBEDDING_PROVIDER_TOKEN,
  DEFAULT_EMBEDDING_PROVIDER,
} from './providers/provider.tokens.js';
export type { EmbeddingProviderName } from './providers/provider.tokens.js';
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
