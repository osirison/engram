import type { EmbeddingProvider } from './embedding-provider.interface.js';

export const EMBEDDING_PROVIDER_TOKEN = 'EMBEDDING_PROVIDER_TOKEN';

export type EmbeddingProviderName = 'openai' | 'disabled' | 'local';

export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProviderName = 'openai';

export type EmbeddingProviderToken = EmbeddingProvider;
