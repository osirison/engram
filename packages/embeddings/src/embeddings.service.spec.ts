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

type RedisMock = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function makeRedis(overrides: Partial<RedisMock> = {}): RedisMock {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

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
      const service = new EmbeddingsService(undefined, provider, TEST_RUNTIME);
      const result = await service.generate({ text: '' });
      expect(result).toBeNull();
    });

    it('returns null for text exceeding max length', async () => {
      const service = new EmbeddingsService(undefined, provider, TEST_RUNTIME);
      const result = await service.generate({ text: 'x'.repeat(8200) });
      expect(result).toBeNull();
    });

    it('accepts text at exactly max length', async () => {
      const service = new EmbeddingsService(undefined, provider, TEST_RUNTIME);
      const result = await service.generate({ text: 'x'.repeat(8191) });
      expect(result).not.toBeNull();
    });
  });

  describe('generate - cache miss', () => {
    it('calls provider and returns embedding', async () => {
      const redis = makeRedis();
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

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

    it('caches the embedding in redis after generation', async () => {
      const redis = makeRedis();
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      await service.generate({ text: 'cache me' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(redis.set).toHaveBeenCalledOnce();
      const [key, value, ttl] = redis.set.mock.calls[0] as [string, string, number];
      expect(key).toMatch(/^embedding:nomic-embed-text:[0-9a-f]{32}$/);
      expect(JSON.parse(value)).toEqual({
        embedding: FAKE_VECTOR,
        model: TEST_RUNTIME.model,
      });
      expect(ttl).toBe(60 * 60 * 24 * 30);
    });
  });

  describe('generate - cache hit', () => {
    it('returns cached embedding without calling provider', async () => {
      const redis = makeRedis({
        get: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ embedding: FAKE_VECTOR, model: 'text-embedding-3-large' })
          ),
      });
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      const result = await service.generate({
        text: 'cached text',
        model: 'text-embedding-3-large',
      });

      expect(result).not.toBeNull();
      expect(result!.embedding).toEqual(FAKE_VECTOR);
      expect(result!.cached).toBe(true);
      expect(result!.model).toBe('text-embedding-3-large');
      expect(provider.generate).not.toHaveBeenCalled();
    });
  });

  describe('cache key behavior', () => {
    it('uses exact input text in key hashing', async () => {
      const redis = makeRedis();
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      await service.generate({ text: '  Hello World  ' });
      await service.generate({ text: 'hello world' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const keys = redis.set.mock.calls.map((call: unknown[]) => call[0] as string);
      expect(keys[0]).not.toBe(keys[1]);
    });

    it('includes model in the key to isolate model-specific vectors', async () => {
      const redis = makeRedis();
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      await service.generate({ text: 'same text', model: 'text-embedding-3-small' });
      await service.generate({ text: 'same text', model: 'text-embedding-3-large' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const keys = redis.set.mock.calls.map((call: unknown[]) => call[0] as string);
      expect(keys[0]).not.toBe(keys[1]);
    });
  });

  describe('error handling', () => {
    it('returns null when provider throws', async () => {
      const throwingProvider = makeProvider({
        generate: vi.fn().mockRejectedValue(new Error('provider error')),
      });
      const service = new EmbeddingsService(undefined, throwingProvider, TEST_RUNTIME);

      const result = await service.generate({ text: 'will fail' });

      expect(result).toBeNull();
    });

    it('continues when redis get throws', async () => {
      const redis = makeRedis({
        get: vi.fn().mockRejectedValueOnce(new Error('redis down')),
      });
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      const result = await service.generate({ text: 'redis error' });

      expect(result).not.toBeNull();
      expect(result!.cached).toBe(false);
    });

    it('continues when redis set throws', async () => {
      const redis = makeRedis({
        set: vi.fn().mockRejectedValueOnce(new Error('redis write failed')),
      });
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      const result = await service.generate({ text: 'redis write error' });

      expect(result).not.toBeNull();
      expect(result!.embedding).toEqual(FAKE_VECTOR);
    });

    it('returns null when provider returns null', async () => {
      const nullProvider = makeProvider({
        generate: vi.fn().mockResolvedValue(null),
      });
      const service = new EmbeddingsService(undefined, nullProvider, TEST_RUNTIME);

      const result = await service.generate({ text: 'no vector' });

      expect(result).toBeNull();
    });

    it('returns null when provider is not injected', async () => {
      const service = new EmbeddingsService();

      const result = await service.generate({ text: 'no provider' });

      expect(result).toBeNull();
    });
  });

  describe('model selection', () => {
    it('uses a custom model when provided', async () => {
      const service = new EmbeddingsService(undefined, provider, TEST_RUNTIME);

      const result = await service.generate({
        text: 'large model',
        model: 'text-embedding-3-large',
      });

      expect(result?.model).toBe('text-embedding-3-large');
      expect(provider.generate).toHaveBeenCalledWith('large model', 'text-embedding-3-large');
    });

    it('accepts arbitrary model strings (open-ended model ids)', async () => {
      const service = new EmbeddingsService(undefined, provider, TEST_RUNTIME);

      const result = await service.generate({
        text: 'custom model',
        model: 'my-org/custom-embedder:v2',
      });

      expect(result?.model).toBe('my-org/custom-embedder:v2');
      expect(provider.generate).toHaveBeenCalledWith('custom model', 'my-org/custom-embedder:v2');
    });

    it('rejects an empty model string', async () => {
      const service = new EmbeddingsService(undefined, provider, TEST_RUNTIME);

      const result = await service.generate({ text: 'hello', model: '' });

      expect(result).toBeNull();
      expect(provider.generate).not.toHaveBeenCalled();
    });
  });

  describe('cache payload validation', () => {
    it('treats a payload recorded under a different model as a parse error', async () => {
      const redis = makeRedis({
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ embedding: FAKE_VECTOR, model: 'other-model' })),
      });
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      const result = await service.generate({ text: 'mismatched cache' });

      expect(result).not.toBeNull();
      expect(result!.cached).toBe(false);
      expect(provider.generate).toHaveBeenCalled();
      expect(service.getCounters()).toMatchObject({ cacheReadErrors: 1 });
    });

    it('treats an empty embedding array as a parse error', async () => {
      const redis = makeRedis({
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ embedding: [], model: TEST_RUNTIME.model })),
      });
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      const result = await service.generate({ text: 'empty cached vector' });

      expect(result).not.toBeNull();
      expect(result!.cached).toBe(false);
      expect(service.getCounters()).toMatchObject({ cacheReadErrors: 1 });
    });

    it('accepts legacy bare-array payloads for the requested model', async () => {
      const redis = makeRedis({
        get: vi.fn().mockResolvedValue(JSON.stringify(FAKE_VECTOR)),
      });
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      const result = await service.generate({ text: 'legacy cache' });

      expect(result).not.toBeNull();
      expect(result!.cached).toBe(true);
      expect(result!.model).toBe(TEST_RUNTIME.model);
      expect(provider.generate).not.toHaveBeenCalled();
    });
  });

  describe('prometheus metrics export', () => {
    it('exports counters in prometheus format', async () => {
      const redis = makeRedis({
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ embedding: FAKE_VECTOR, model: TEST_RUNTIME.model })),
      });
      const service = new EmbeddingsService(redis as never, provider, TEST_RUNTIME);

      await service.generate({ text: 'metric 1' });

      const metrics = service.getPrometheusMetrics();

      expect(metrics).toContain('# TYPE engram_embeddings_requests_total counter');
      expect(metrics).toContain('engram_embeddings_requests_total 1');
      expect(metrics).toContain('engram_embeddings_cacheHits_total 1');
      expect(metrics).toContain('engram_embeddings_providerSuccess_total 0');
    });
  });
});
