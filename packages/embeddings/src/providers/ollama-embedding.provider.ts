import { Injectable, Logger } from '@nestjs/common';
import type { EmbeddingModel } from '../types.js';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_TIMEOUT_MS = 30_000;

/**
 * Embedding provider backed by a local Ollama server (default provider).
 * Talks to the native `/api/embed` endpoint via fetch — no SDK dependency.
 * Follows the degradation contract: every failure returns null with a
 * warning so memory workflows continue without a vector.
 */
@Injectable()
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OllamaEmbeddingProvider.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  }

  async generate(text: string, model: EmbeddingModel): Promise<number[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          JSON.stringify({
            event: 'embedding.provider.ollama.http_error',
            status: response.status,
            model,
            hint:
              response.status === 404
                ? `Model may be missing — run: ollama pull ${model}`
                : undefined,
          })
        );
        return null;
      }

      const body = (await response.json()) as { embeddings?: unknown };
      const first = Array.isArray(body.embeddings) ? body.embeddings[0] : undefined;
      if (
        !Array.isArray(first) ||
        first.length === 0 ||
        !first.every((value) => typeof value === 'number')
      ) {
        this.logger.warn(
          JSON.stringify({ event: 'embedding.provider.ollama.malformed_response', model })
        );
        return null;
      }

      return first as number[];
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      this.logger.warn(
        JSON.stringify({
          event: timedOut
            ? 'embedding.provider.ollama.timeout'
            : 'embedding.provider.ollama.request_failed',
          model,
          baseUrl: this.baseUrl,
          error: err instanceof Error ? err.message : String(err),
          hint: timedOut ? undefined : `Is Ollama running at ${this.baseUrl}?`,
        })
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
