import type { EmbeddingProvider } from './embedding-provider.interface.js';

export const EMBEDDING_PROVIDER_TOKEN = 'EMBEDDING_PROVIDER_TOKEN';

export type EmbeddingProviderName = 'ollama' | 'openai' | 'disabled' | 'local';

/** Local-first default: Ollama with nomic-embed-text (no API key required). */
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProviderName = 'ollama';

export type EmbeddingProviderToken = EmbeddingProvider;
