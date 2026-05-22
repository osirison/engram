import { Module } from '@nestjs/common';
import { RedisModule } from '@engram/redis';
import { EmbeddingsService } from './embeddings.service.js';
import { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider.js';

@Module({
  imports: [RedisModule],
  providers: [OpenAIEmbeddingProvider, EmbeddingsService],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
