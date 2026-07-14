import type { EmbeddingProvider } from './embedding-provider.interface.js';
import type { EmbeddingProviderName } from './provider.tokens.js';

export function selectEmbeddingProvider(
  provider: EmbeddingProviderName,
  providers: {
    ollama: EmbeddingProvider;
    openai: EmbeddingProvider;
    disabled: EmbeddingProvider;
    local: EmbeddingProvider;
  }
): EmbeddingProvider {
  switch (provider) {
    case 'disabled':
      return providers.disabled;
    case 'local':
      return providers.local;
    case 'openai':
      return providers.openai;
    case 'ollama':
    default:
      return providers.ollama;
  }
}
