import { Module } from '@nestjs/common';
import { RedisModule } from '@engram/redis';
import { EmbeddingsService } from './embeddings.service.js';
import { DisabledEmbeddingProvider } from './providers/disabled-embedding.provider.js';
import { LocalEmbeddingProvider } from './providers/local-embedding.provider.js';
import { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider.js';
import {
  DEFAULT_EMBEDDING_PROVIDER,
  EMBEDDING_PROVIDER_TOKEN,
  type EmbeddingProviderName,
} from './providers/provider.tokens.js';
import type { EmbeddingProvider } from './providers/embedding-provider.interface.js';
import { selectEmbeddingProvider } from './providers/select-embedding-provider.js';

@Module({
  imports: [RedisModule],
  providers: [
    OpenAIEmbeddingProvider,
    DisabledEmbeddingProvider,
    LocalEmbeddingProvider,
    {
      provide: EMBEDDING_PROVIDER_TOKEN,
      inject: [OpenAIEmbeddingProvider, DisabledEmbeddingProvider, LocalEmbeddingProvider],
      useFactory: (
        openaiProvider: OpenAIEmbeddingProvider,
        disabledProvider: DisabledEmbeddingProvider,
        localProvider: LocalEmbeddingProvider
      ): EmbeddingProvider => {
        const provider =
          (process.env['EMBEDDING_PROVIDER'] as EmbeddingProviderName | undefined) ??
          DEFAULT_EMBEDDING_PROVIDER;

        return selectEmbeddingProvider(provider, {
          openai: openaiProvider,
          disabled: disabledProvider,
          local: localProvider,
        });
      },
    },
    EmbeddingsService,
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
