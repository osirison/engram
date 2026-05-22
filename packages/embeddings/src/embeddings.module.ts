import { Module } from '@nestjs/common';
import { RedisModule } from '@engram/redis';
import { EmbeddingsService } from './embeddings.service.js';
import { DisabledEmbeddingProvider } from './providers/disabled-embedding.provider.js';
import { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider.js';
import {
  DEFAULT_EMBEDDING_PROVIDER,
  EMBEDDING_PROVIDER_TOKEN,
  type EmbeddingProviderName,
} from './providers/provider.tokens.js';

@Module({
  imports: [RedisModule],
  providers: [
    OpenAIEmbeddingProvider,
    DisabledEmbeddingProvider,
    {
      provide: EMBEDDING_PROVIDER_TOKEN,
      inject: [OpenAIEmbeddingProvider, DisabledEmbeddingProvider],
      useFactory: (
        openaiProvider: OpenAIEmbeddingProvider,
        disabledProvider: DisabledEmbeddingProvider,
      ) => {
        const provider =
          (process.env['EMBEDDING_PROVIDER'] as EmbeddingProviderName | undefined) ??
          DEFAULT_EMBEDDING_PROVIDER;

        switch (provider) {
          case 'disabled':
            return disabledProvider;
          case 'openai':
          default:
            return openaiProvider;
        }
      },
    },
    EmbeddingsService,
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
