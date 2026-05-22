import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '@engram/redis';
import {
  EMBEDDING_CACHE_TTL,
  type EmbeddingResult,
  type GenerateEmbeddingInput,
  generateEmbeddingSchema,
} from './types.js';
import type { EmbeddingProvider } from './providers/embedding-provider.interface.js';
import { EMBEDDING_PROVIDER_TOKEN } from './providers/provider.tokens.js';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly provider?: EmbeddingProvider,
  ) {}

  /**
   * Generate an embedding for the given text.
   * Returns null (and logs a warning) instead of throwing when the API is
   * unavailable, so that callers can continue without an embedding.
   */
  async generate(input: GenerateEmbeddingInput): Promise<EmbeddingResult | null> {
    const parsed = generateEmbeddingSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      this.logger.warn(`Embedding input validation failed: ${msg}`);
      return null;
    }

    const { text, model } = parsed.data;

    const cacheKey = this.buildCacheKey(text);

    // Try cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug(`Embedding cache hit for key: ${cacheKey}`);
          return {
            embedding: JSON.parse(cached) as number[],
            model,
            cached: true,
          };
        }
      } catch (err) {
        this.logger.warn('Redis cache read failed, proceeding without cache', err);
      }
    }

    // Generate via provider
    const embedding = await this.provider?.generate(text, model).catch((error) => {
      this.logger.warn('Embedding provider call failed', error);
      return null;
    });
    if (!embedding) {
      this.logger.warn('Embedding provider returned no vector');
      return null;
    }

    // Persist to cache asynchronously — don't block the response
    if (this.redis) {
      void this.cacheEmbedding(cacheKey, embedding);
    }

    return { embedding, model, cached: false };
  }

  private async cacheEmbedding(key: string, embedding: number[]): Promise<void> {
    try {
      await this.redis!.set(key, JSON.stringify(embedding), EMBEDDING_CACHE_TTL);
      this.logger.debug(`Embedding cached at key: ${key}`);
    } catch (err) {
      this.logger.warn('Failed to cache embedding in Redis', err);
    }
  }

  private buildCacheKey(text: string): string {
    const normalized = text.trim().toLowerCase();
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    return `embedding:${hash}`;
  }
}
