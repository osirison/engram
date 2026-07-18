import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type EmbeddingResult,
  type GenerateEmbeddingInput,
  generateEmbeddingSchema,
} from './types.js';
import {
  EMBEDDING_RUNTIME_TOKEN,
  resolveEmbeddingRuntime,
  type EmbeddingRuntime,
} from './embedding-runtime.js';
import type { EmbeddingProvider } from './providers/embedding-provider.interface.js';
import { EMBEDDING_PROVIDER_TOKEN } from './providers/provider.tokens.js';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly counters = {
    requests: 0,
    providerSuccess: 0,
    providerErrors: 0,
    providerNull: 0,
  };

  private static readonly METRIC_PREFIX = 'engram_embeddings';

  private readonly runtime: EmbeddingRuntime;

  constructor(
    @Optional() @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly provider?: EmbeddingProvider,
    @Optional() @Inject(EMBEDDING_RUNTIME_TOKEN) runtime?: EmbeddingRuntime
  ) {
    this.runtime = runtime ?? resolveEmbeddingRuntime();
  }

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

    const { text } = parsed.data;
    const model = parsed.data.model ?? this.runtime.model;

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

  getPrometheusMetrics(): string {
    const counters = this.getCounters();
    const lines = Object.entries(counters).flatMap(([name, value]) => {
      const metricName = `${EmbeddingsService.METRIC_PREFIX}_${name}_total`;
      return [
        `# HELP ${metricName} Total number of embedding ${name} events.`,
        `# TYPE ${metricName} counter`,
        `${metricName} ${value}`,
      ];
    });

    return `${lines.join('\n')}\n`;
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
