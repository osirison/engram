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
  private readonly counters = {
    requests: 0,
    cacheHits: 0,
    providerSuccess: 0,
    providerErrors: 0,
    providerNull: 0,
    cacheReadErrors: 0,
    cacheWriteErrors: 0,
  };

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly provider?: EmbeddingProvider
  ) {}

  /**
   * Generate an embedding for the given text.
   * Returns null (and logs a warning) instead of throwing when the API is
   * unavailable, so that callers can continue without an embedding.
   */
  async generate(input: GenerateEmbeddingInput): Promise<EmbeddingResult | null> {
    this.counters.requests += 1;

    const parsed = generateEmbeddingSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      this.logStructured('warn', 'embedding.generate.validation_failed', { message: msg });
      return null;
    }

    const { text, model } = parsed.data;

    const cacheKey = this.buildCacheKey(text);

    // Try cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.counters.cacheHits += 1;
          this.logStructured('debug', 'embedding.generate.cache_hit', {
            cacheKey,
            counters: this.counters,
          });
          return {
            embedding: JSON.parse(cached) as number[],
            model,
            cached: true,
          };
        }
      } catch (err) {
        this.counters.cacheReadErrors += 1;
        this.logStructured('warn', 'embedding.generate.cache_read_error', {
          error: err instanceof Error ? err.message : String(err),
          counters: this.counters,
        });
      }
    }

    // Generate via provider
    const embedding = await this.provider?.generate(text, model).catch((error) => {
      this.counters.providerErrors += 1;
      this.logStructured('warn', 'embedding.generate.provider_error', {
        error: error instanceof Error ? error.message : String(error),
        counters: this.counters,
      });
      return null;
    });
    if (!embedding) {
      this.counters.providerNull += 1;
      this.logStructured('warn', 'embedding.generate.provider_null', {
        model,
        textLength: text.length,
        counters: this.counters,
      });
      return null;
    }

    this.counters.providerSuccess += 1;

    // Persist to cache asynchronously — don't block the response
    if (this.redis) {
      void this.cacheEmbedding(cacheKey, embedding);
    }

    this.logStructured('debug', 'embedding.generate.success', {
      model,
      textLength: text.length,
      dimensions: embedding.length,
      counters: this.counters,
    });

    return { embedding, model, cached: false };
  }

  getCounters(): Readonly<typeof this.counters> {
    return { ...this.counters };
  }

  private async cacheEmbedding(key: string, embedding: number[]): Promise<void> {
    try {
      await this.redis!.set(key, JSON.stringify(embedding), EMBEDDING_CACHE_TTL);
      this.logStructured('debug', 'embedding.generate.cache_write_success', {
        cacheKey: key,
      });
    } catch (err) {
      this.counters.cacheWriteErrors += 1;
      this.logStructured('warn', 'embedding.generate.cache_write_error', {
        cacheKey: key,
        error: err instanceof Error ? err.message : String(err),
        counters: this.counters,
      });
    }
  }

  private buildCacheKey(text: string): string {
    const normalized = text.trim().toLowerCase();
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    return `embedding:${hash}`;
  }

  private logStructured(
    level: 'debug' | 'warn' | 'error',
    event: string,
    metadata: Record<string, unknown>
  ): void {
    const payload = JSON.stringify({ event, ...metadata });
    if (level === 'debug') {
      this.logger.debug(payload);
      return;
    }
    if (level === 'warn') {
      this.logger.warn(payload);
      return;
    }
    this.logger.error(payload);
  }
}
