import type { EmbeddingProvider } from './embedding-provider.interface.js';
import type { EmbeddingProviderName } from './provider.tokens.js';

export function selectEmbeddingProvider(
  provider: EmbeddingProviderName,
  providers: {
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
    default:
      return providers.openai;
  }
}
