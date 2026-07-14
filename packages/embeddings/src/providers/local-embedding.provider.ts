import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { EMBEDDING_RUNTIME_TOKEN, type EmbeddingRuntime } from '../embedding-runtime.js';
import type { EmbeddingModel } from '../types.js';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

const DEFAULT_LOCAL_DIMENSIONS = 1536;

@Injectable()
export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(LocalEmbeddingProvider.name);
  private readonly dimensions: number;

  constructor(@Optional() @Inject(EMBEDDING_RUNTIME_TOKEN) runtime?: EmbeddingRuntime) {
    this.dimensions = runtime?.dimensions ?? DEFAULT_LOCAL_DIMENSIONS;
  }

  async generate(text: string, _model: EmbeddingModel): Promise<number[] | null> {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    // Deterministic local scaffold provider for non-production/testing use.
    const hashBytes = createHash('sha256').update(normalized).digest();
    const vector = Array.from({ length: this.dimensions }, (_, i) => {
      const byte = hashBytes[i % hashBytes.length] ?? 0;
      return byte / 255;
    });

    this.logger.debug(
      JSON.stringify({
        event: 'embedding.provider.local.generated',
        textLength: text.length,
        dimensions: vector.length,
      })
    );

    return vector;
  }
}
