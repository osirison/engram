import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { EmbeddingModel } from '../types.js';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

const LOCAL_DIMENSIONS = 1536;

@Injectable()
export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(LocalEmbeddingProvider.name);

  async generate(text: string, _model: EmbeddingModel): Promise<number[] | null> {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    // Deterministic local scaffold provider for non-production/testing use.
    const hashBytes = createHash('sha256').update(normalized).digest();
    const vector = Array.from({ length: LOCAL_DIMENSIONS }, (_, i) => {
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
