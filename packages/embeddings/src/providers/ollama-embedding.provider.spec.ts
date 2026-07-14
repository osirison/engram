import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaEmbeddingProvider } from './ollama-embedding.provider';

const VECTOR_768 = Array.from({ length: 768 }, (_, i) => i * 0.001);

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('OllamaEmbeddingProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    delete process.env['OLLAMA_URL'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OLLAMA_URL'];
  });

  it('POSTs to /api/embed and returns the first embedding', async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({ embeddings: [VECTOR_768] }));
    const provider = new OllamaEmbeddingProvider();

    const result = await provider.generate('hello world', 'nomic-embed-text');

    expect(result).toEqual(VECTOR_768);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/embed');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'nomic-embed-text',
      input: 'hello world',
    });
  });

  it('respects OLLAMA_URL and strips trailing slashes', async () => {
    process.env['OLLAMA_URL'] = 'http://ollama.internal:11434///';
    fetchMock.mockResolvedValue(mockFetchResponse({ embeddings: [VECTOR_768] }));
    const provider = new OllamaEmbeddingProvider();

    await provider.generate('hi', 'nomic-embed-text');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://ollama.internal:11434/api/embed');
  });

  it('returns null on non-2xx responses', async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({ error: 'model not found' }, false, 404));
    const provider = new OllamaEmbeddingProvider();

    expect(await provider.generate('hi', 'missing-model')).toBeNull();
  });

  it('returns null on network errors', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new OllamaEmbeddingProvider();

    expect(await provider.generate('hi', 'nomic-embed-text')).toBeNull();
  });

  it('returns null on abort/timeout', async () => {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);
    const provider = new OllamaEmbeddingProvider();

    expect(await provider.generate('hi', 'nomic-embed-text')).toBeNull();
  });

  it.each([
    ['missing embeddings key', {}],
    ['embeddings not an array', { embeddings: 'nope' }],
    ['empty embeddings list', { embeddings: [] }],
    ['empty first vector', { embeddings: [[]] }],
    ['non-numeric values', { embeddings: [['a', 'b']] }],
  ])('returns null on malformed response: %s', async (_label, body) => {
    fetchMock.mockResolvedValue(mockFetchResponse(body));
    const provider = new OllamaEmbeddingProvider();

    expect(await provider.generate('hi', 'nomic-embed-text')).toBeNull();
  });
});
