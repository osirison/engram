import { Injectable, Logger } from '@nestjs/common';
import type { EmbeddingModel } from '../types.js';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_TIMEOUT_MS = 30_000;
/** Shortest prefix worth embedding when retrying an over-long input. */
const MIN_TRUNCATED_CHARS = 1_000;
/** Halving retries for context-length rejections (full → 1/2 → 1/4). */
const MAX_TRUNCATION_RETRIES = 2;

/**
 * Embedding provider backed by a local Ollama server (default provider).
 * Talks to the native `/api/embed` endpoint via fetch — no SDK dependency.
 * Follows the degradation contract: every failure returns null with a
 * warning so memory workflows continue without a vector.
 *
 * Context-length degradation: some embedding GGUFs (e.g. nomic-embed-text)
 * are packaged with a trained context smaller than our character-based input
 * cap, and Ollama rejects over-long inputs even with `truncate` set. A
 * truncated-content embedding is far better for recall than none, so a
 * context-length rejection retries with the first half, then the first
 * quarter, of the text before giving up.
 */
@Injectable()
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OllamaEmbeddingProvider.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  }

  async generate(text: string, model: EmbeddingModel): Promise<number[] | null> {
    let input = text;
    for (let attempt = 0; attempt <= MAX_TRUNCATION_RETRIES; attempt += 1) {
      const outcome = await this.requestEmbedding(input, model);
      if (outcome.kind === 'ok') {
        if (attempt > 0) {
          this.logger.warn(
            JSON.stringify({
              event: 'embedding.provider.ollama.truncated_input',
              model,
              originalChars: text.length,
              embeddedChars: input.length,
              hint: 'Input exceeded the model context; embedded a prefix instead.',
            })
          );
        }
        return outcome.vector;
      }
      if (outcome.kind !== 'context_length') {
        return null;
      }
      const next = Math.floor(input.length / 2);
      if (next < MIN_TRUNCATED_CHARS) {
        return null;
      }
      input = input.slice(0, next);
    }
    return null;
  }

  private async requestEmbedding(
    text: string,
    model: EmbeddingModel
  ): Promise<{ kind: 'ok'; vector: number[] } | { kind: 'context_length' } | { kind: 'error' }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: text, truncate: true }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (/context length/i.test(errorBody)) {
          return { kind: 'context_length' };
        }
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
        return { kind: 'error' };
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
        return { kind: 'error' };
      }

      return { kind: 'ok', vector: first as number[] };
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
      return { kind: 'error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
