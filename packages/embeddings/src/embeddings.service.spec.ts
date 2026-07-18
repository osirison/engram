import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmbeddingsService } from './embeddings.service';
import type { EmbeddingRuntime } from './embedding-runtime';
import type { EmbeddingProvider } from './providers/embedding-provider.interface.js';

const FAKE_VECTOR = Array.from({ length: 1536 }, (_, i) => i * 0.001);

// Explicit runtime keeps unit tests independent of ambient env vars
// (CI sets EMBEDDING_PROVIDER=local, which would change the lazy fallback).
const TEST_RUNTIME: EmbeddingRuntime = {
  provider: 'ollama',
  model: 'nomic-embed-text',
  dimensions: 768,
};

function makeProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    generate: vi.fn().mockResolvedValue(FAKE_VECTOR),
    ...overrides,
  };
}

describe('EmbeddingsService', () => {
  let provider: EmbeddingProvider;

  beforeEach(() => {
    provider = makeProvider();
  });

  describe('input validation', () => {
    it('returns null for empty text', async () => {
      const service = new EmbeddingsService(provider, TEST_RUNTIME);
      const result = await service.generate({ text: '' });
      expect(result).toBeNull();
    });

    it('returns null for text exceeding max length', async () => {
      const service = new EmbeddingsService(provider, TEST_RUNTIME);
      const result = await service.generate({ text: 'x'.repeat(8200) });
      expect(result).toBeNull();
    });

    it('accepts text at exactly max length', async () => {
      const service = new EmbeddingsService(provider, TEST_RUNTIME);
      const result = await service.generate({ text: 'x'.repeat(8191) });
      expect(result).not.toBeNull();
    });
  });

  describe('generate', () => {
    it('calls provider and returns embedding', async () => {
      const service = new EmbeddingsService(provider, TEST_RUNTIME);

      const result = await service.generate({ text: 'remember this' });

      expect(result).not.toBeNull();
      expect(result!.embedding).toEqual(FAKE_VECTOR);
      expect(result!.model).toBe(TEST_RUNTIME.model);
      expect(result!.cached).toBe(false);
      expect(provider.generate).toHaveBeenCalledWith('remember this', TEST_RUNTIME.model);
      expect(service.getCounters()).toMatchObject({
        requests: 1,
        providerSuccess: 1,
      });
    });
  });

  describe('error handling', () => {
    it('returns null when provider throws', async () => {
      const throwingProvider = makeProvider({
        generate: vi.fn().mockRejectedValue(new Error('provider error')),
      });
      const service = new EmbeddingsService(throwingProvider, TEST_RUNTIME);

      const result = await service.generate({ text: 'will fail' });

      expect(result).toBeNull();
      expect(service.getCounters()).toMatchObject({ providerErrors: 1 });
    });

    it('returns null when provider returns null', async () => {
      const nullProvider = makeProvider({
        generate: vi.fn().mockResolvedValue(null),
      });
      const service = new EmbeddingsService(nullProvider, TEST_RUNTIME);

      const result = await service.generate({ text: 'no vector' });

      expect(result).toBeNull();
      expect(service.getCounters()).toMatchObject({ providerNull: 1 });
    });

    it('returns null when provider is not injected', async () => {
      const service = new EmbeddingsService();

      const result = await service.generate({ text: 'no provider' });

      expect(result).toBeNull();
    });
  });

  describe('model selection', () => {
    it('uses a custom model when provided', async () => {
      const service = new EmbeddingsService(provider, TEST_RUNTIME);

      const result = await service.generate({
        text: 'large model',
        model: 'text-embedding-3-large',
      });

      expect(result?.model).toBe('text-embedding-3-large');
      expect(provider.generate).toHaveBeenCalledWith('large model', 'text-embedding-3-large');
    });

    it('accepts arbitrary model strings (open-ended model ids)', async () => {
      const service = new EmbeddingsService(provider, TEST_RUNTIME);

      const result = await service.generate({
        text: 'custom model',
        model: 'my-org/custom-embedder:v2',
      });

      expect(result?.model).toBe('my-org/custom-embedder:v2');
      expect(provider.generate).toHaveBeenCalledWith('custom model', 'my-org/custom-embedder:v2');
    });

    it('rejects an empty model string', async () => {
      const service = new EmbeddingsService(provider, TEST_RUNTIME);

      const result = await service.generate({ text: 'hello', model: '' });

      expect(result).toBeNull();
      expect(provider.generate).not.toHaveBeenCalled();
    });
  });

  describe('prometheus metrics export', () => {
    it('exports counters in prometheus format', async () => {
      const service = new EmbeddingsService(provider, TEST_RUNTIME);

      await service.generate({ text: 'metric 1' });

      const metrics = service.getPrometheusMetrics();

      expect(metrics).toContain('# TYPE engram_embeddings_requests_total counter');
      expect(metrics).toContain('engram_embeddings_requests_total 1');
      expect(metrics).toContain('engram_embeddings_providerSuccess_total 1');
    });
  });
});
