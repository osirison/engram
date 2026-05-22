import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EmbeddingsService } from './embeddings.service';
import { DEFAULT_EMBEDDING_MODEL } from './types';

// ---------------------------------------------------------------------------
// OpenAI SDK mock
// ---------------------------------------------------------------------------
// Declare before the factory so the closure captures the reference.
const mockEmbeddingsCreate = vi.fn();

vi.mock('openai', () => {
  // Must use a regular function (not arrow) so `new` works correctly.
  function MockOpenAI() {
    return { embeddings: { create: mockEmbeddingsCreate } };
  }
  return { default: MockOpenAI };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FAKE_VECTOR = Array.from({ length: 1536 }, (_, i) => i * 0.001);

function mockEmbeddingResponse(vector: number[] = FAKE_VECTOR) {
  return {
    data: [{ embedding: vector, index: 0, object: 'embedding' }],
    model: DEFAULT_EMBEDDING_MODEL,
    usage: { prompt_tokens: 10, total_tokens: 10 },
  };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('EmbeddingsService', () => {
  let OLD_KEY: string | undefined;

  beforeEach(() => {
    OLD_KEY = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-fake';
    // Only reset the inner create mock — the constructor mock is a plain
    // function and doesn't need resetting.
    mockEmbeddingsCreate.mockReset();
    // Provide a safe base implementation so accidental calls return something
    // recognisable rather than undefined.
    mockEmbeddingsCreate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (OLD_KEY === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = OLD_KEY;
    }
  });

  // -------------------------------------------------------------------------
  // When OPENAI_API_KEY is absent
  // -------------------------------------------------------------------------
  describe('when OPENAI_API_KEY is not set', () => {
    it('returns null for any input without calling OpenAI', async () => {
      delete process.env['OPENAI_API_KEY'];
      const service = new EmbeddingsService();

      const result = await service.generate({ text: 'hello world' });

      expect(result).toBeNull();
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  describe('input validation', () => {
    it('returns null for empty text', async () => {
      const service = new EmbeddingsService();
      const result = await service.generate({ text: '' });
      expect(result).toBeNull();
    });

    it('returns null for text exceeding max length', async () => {
      const service = new EmbeddingsService();
      const result = await service.generate({ text: 'x'.repeat(8200) });
      expect(result).toBeNull();
    });

    it('accepts text at exactly max length', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValueOnce(mockEmbeddingResponse());
      const service = new EmbeddingsService();
      const result = await service.generate({ text: 'x'.repeat(8191) });
      expect(result).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Happy path — cache miss then API call
  // -------------------------------------------------------------------------
  describe('generate — cache miss', () => {
    it('calls OpenAI and returns the embedding', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValueOnce(mockEmbeddingResponse());
      const redis = makeRedis();
      const service = new EmbeddingsService(redis as never);

      const result = await service.generate({ text: 'remember this' });

      expect(result).not.toBeNull();
      expect(result!.embedding).toEqual(FAKE_VECTOR);
      expect(result!.model).toBe(DEFAULT_EMBEDDING_MODEL);
      expect(result!.cached).toBe(false);
      expect(mockEmbeddingsCreate).toHaveBeenCalledOnce();
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: DEFAULT_EMBEDDING_MODEL,
        input: 'remember this',
      });
    });

    it('caches the embedding in Redis after generation', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValueOnce(mockEmbeddingResponse());
      const redis = makeRedis();
      const service = new EmbeddingsService(redis as never);

      await service.generate({ text: 'cache me' });

      // Redis.set is called asynchronously; flush micro-tasks
      await new Promise((r) => setTimeout(r, 0));

      expect(redis.set).toHaveBeenCalledOnce();
      const [key, value, ttl] = redis.set.mock.calls[0] as [string, string, number];
      expect(key).toMatch(/^embedding:[0-9a-f]{32}$/);
      expect(JSON.parse(value)).toEqual(FAKE_VECTOR);
      expect(ttl).toBe(60 * 60 * 24 * 30); // 30 days
    });
  });

  // -------------------------------------------------------------------------
  // Cache hit path
  // -------------------------------------------------------------------------
  describe('generate — cache hit', () => {
    it('returns cached embedding without calling OpenAI', async () => {
      const cached = FAKE_VECTOR;
      const redis = makeRedis({
        get: vi.fn().mockResolvedValue(JSON.stringify(cached)),
      });
      const service = new EmbeddingsService(redis as never);

      const result = await service.generate({ text: 'cached text' });

      expect(result).not.toBeNull();
      expect(result!.embedding).toEqual(cached);
      expect(result!.cached).toBe(true);
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Deterministic cache keys
  // -------------------------------------------------------------------------
  describe('cache key normalisation', () => {
    it('produces the same key for text with different casing/whitespace', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValue(mockEmbeddingResponse());
      const redis = makeRedis();
      const service = new EmbeddingsService(redis as never);

      await service.generate({ text: '  Hello World  ' });
      await service.generate({ text: 'hello world' });

      await new Promise((r) => setTimeout(r, 0));

      // Both calls should produce the same cache key
      const keys = redis.set.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(keys[0]).toBe(keys[1]);
    });
  });

  // -------------------------------------------------------------------------
  // Error resilience
  // -------------------------------------------------------------------------
  describe('error handling', () => {
    it('returns null when OpenAI throws instead of propagating', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockRejectedValueOnce(new Error('API rate limited'));
      const service = new EmbeddingsService();

      const result = await service.generate({ text: 'will fail' });

      expect(result).toBeNull();
    });

    it('continues when Redis get throws', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValueOnce(mockEmbeddingResponse());
      const redis = makeRedis({
        get: vi.fn().mockRejectedValueOnce(new Error('Redis down')),
      });
      const service = new EmbeddingsService(redis as never);

      const result = await service.generate({ text: 'redis error' });

      expect(result).not.toBeNull();
      expect(result!.cached).toBe(false);
    });

    it('continues when Redis set throws', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValueOnce(mockEmbeddingResponse());
      const redis = makeRedis({
        set: vi.fn().mockRejectedValueOnce(new Error('Redis write failed')),
      });
      const service = new EmbeddingsService(redis as never);

      const result = await service.generate({ text: 'redis write error' });

      expect(result).not.toBeNull();
      expect(result!.embedding).toEqual(FAKE_VECTOR);
    });

    it('works without Redis (no caching)', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValueOnce(mockEmbeddingResponse());
      const service = new EmbeddingsService(); // no redis injected

      const result = await service.generate({ text: 'no cache' });

      expect(result).not.toBeNull();
      expect(result!.cached).toBe(false);
    });

    it('returns null when OpenAI returns empty embedding data', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValueOnce({ data: [], model: DEFAULT_EMBEDDING_MODEL });
      const service = new EmbeddingsService();

      const result = await service.generate({ text: 'empty response' });

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Custom model selection
  // -------------------------------------------------------------------------
  describe('model selection', () => {
    it('uses a custom model when provided', async () => {
      // use mockEmbeddingsCreate directly
      mockEmbeddingsCreate.mockResolvedValueOnce(mockEmbeddingResponse());
      const service = new EmbeddingsService();

      const result = await service.generate({
        text: 'large model',
        model: 'text-embedding-3-large',
      });

      expect(result?.model).toBe('text-embedding-3-large');
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        input: 'large model',
      });
    });
  });
});
