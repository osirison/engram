import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service.js';
import {
  EMBEDDING_RUNTIME_TOKEN,
  resolveEmbeddingRuntime,
  type EmbeddingRuntime,
} from './embedding-runtime.js';
import { DisabledEmbeddingProvider } from './providers/disabled-embedding.provider.js';
import { LocalEmbeddingProvider } from './providers/local-embedding.provider.js';
import { OllamaEmbeddingProvider } from './providers/ollama-embedding.provider.js';
import { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider.js';
import { EMBEDDING_PROVIDER_TOKEN } from './providers/provider.tokens.js';
import type { EmbeddingProvider } from './providers/embedding-provider.interface.js';
import { selectEmbeddingProvider } from './providers/select-embedding-provider.js';

@Module({
  providers: [
    OllamaEmbeddingProvider,
    OpenAIEmbeddingProvider,
    DisabledEmbeddingProvider,
    LocalEmbeddingProvider,
    {
      provide: EMBEDDING_RUNTIME_TOKEN,
      useFactory: (): EmbeddingRuntime => resolveEmbeddingRuntime(),
    },
    {
      provide: EMBEDDING_PROVIDER_TOKEN,
      inject: [
        EMBEDDING_RUNTIME_TOKEN,
        OllamaEmbeddingProvider,
        OpenAIEmbeddingProvider,
        DisabledEmbeddingProvider,
        LocalEmbeddingProvider,
      ],
      useFactory: (
        runtime: EmbeddingRuntime,
        ollamaProvider: OllamaEmbeddingProvider,
        openaiProvider: OpenAIEmbeddingProvider,
        disabledProvider: DisabledEmbeddingProvider,
        localProvider: LocalEmbeddingProvider
      ): EmbeddingProvider =>
        selectEmbeddingProvider(runtime.provider, {
          ollama: ollamaProvider,
          openai: openaiProvider,
          disabled: disabledProvider,
          local: localProvider,
        }),
    },
    EmbeddingsService,
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
