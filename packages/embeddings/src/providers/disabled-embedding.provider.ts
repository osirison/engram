import { Injectable, Logger } from '@nestjs/common';
import type { EmbeddingModel } from '../types.js';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

@Injectable()
export class DisabledEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(DisabledEmbeddingProvider.name);

  async generate(_text: string, _model: EmbeddingModel): Promise<number[] | null> {
    this.logger.debug('Embedding provider is disabled, returning null vector');
    return null;
  }
}
