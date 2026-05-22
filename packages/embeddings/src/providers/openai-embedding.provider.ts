import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { EmbeddingModel } from '../types.js';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

@Injectable()
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAIEmbeddingProvider.name);
  private readonly client: OpenAI | null;

  constructor() {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set - OpenAI embeddings are disabled');
      this.client = null;
      return;
    }

    this.client = new OpenAI({ apiKey });
  }

  async generate(text: string, model: EmbeddingModel): Promise<number[] | null> {
    if (!this.client) {
      return null;
    }

    try {
      const response = await this.client.embeddings.create({
        model,
        input: text,
      });
      return response.data[0]?.embedding ?? null;
    } catch (err) {
      this.logger.error('OpenAI embedding generation failed', err);
      return null;
    }
  }
}
