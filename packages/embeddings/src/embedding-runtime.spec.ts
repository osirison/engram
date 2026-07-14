import { describe, it, expect } from 'vitest';
import { PROVIDER_DEFAULT_MODELS, resolveEmbeddingRuntime } from './embedding-runtime';
import { DEFAULT_EMBEDDING_PROVIDER } from './providers/provider.tokens';

describe('resolveEmbeddingRuntime', () => {
  it('defaults to ollama with nomic-embed-text at 768 dims when env is empty', () => {
    const runtime = resolveEmbeddingRuntime({});
    expect(runtime.provider).toBe('ollama');
    expect(runtime.model).toBe('nomic-embed-text');
    expect(runtime.dimensions).toBe(768);
  });

  it('exposes ollama as the package default provider', () => {
    expect(DEFAULT_EMBEDDING_PROVIDER).toBe('ollama');
  });

  it('resolves per-provider default models', () => {
    expect(resolveEmbeddingRuntime({ EMBEDDING_PROVIDER: 'openai' }).model).toBe(
      'text-embedding-3-small'
    );
    expect(resolveEmbeddingRuntime({ EMBEDDING_PROVIDER: 'local' }).model).toBe('local-hash');
    expect(resolveEmbeddingRuntime({ EMBEDDING_PROVIDER: 'ollama' }).model).toBe(
      'nomic-embed-text'
    );
    expect(PROVIDER_DEFAULT_MODELS.disabled).toBe('disabled');
  });

  it('resolves known-model dimensions per provider default', () => {
    expect(resolveEmbeddingRuntime({ EMBEDDING_PROVIDER: 'openai' }).dimensions).toBe(1536);
    expect(resolveEmbeddingRuntime({ EMBEDDING_PROVIDER: 'local' }).dimensions).toBe(1536);
  });

  it('honours EMBEDDING_MODEL override with known dimensions', () => {
    const runtime = resolveEmbeddingRuntime({ EMBEDDING_MODEL: 'mxbai-embed-large' });
    expect(runtime.model).toBe('mxbai-embed-large');
    expect(runtime.dimensions).toBe(1024);
  });

  it('leaves dimensions undefined for unknown models', () => {
    const runtime = resolveEmbeddingRuntime({ EMBEDDING_MODEL: 'some-custom-model' });
    expect(runtime.model).toBe('some-custom-model');
    expect(runtime.dimensions).toBeUndefined();
  });

  it('prefers explicit VECTOR_DIMENSIONS over the known-model dimension', () => {
    const runtime = resolveEmbeddingRuntime({
      EMBEDDING_MODEL: 'nomic-embed-text',
      VECTOR_DIMENSIONS: '512',
    });
    expect(runtime.dimensions).toBe(512);
  });

  it('ignores invalid VECTOR_DIMENSIONS values', () => {
    expect(resolveEmbeddingRuntime({ VECTOR_DIMENSIONS: 'abc' }).dimensions).toBe(768);
    expect(resolveEmbeddingRuntime({ VECTOR_DIMENSIONS: '-5' }).dimensions).toBe(768);
    expect(resolveEmbeddingRuntime({ VECTOR_DIMENSIONS: '0' }).dimensions).toBe(768);
  });

  it('normalizes unknown provider names to the default provider', () => {
    const runtime = resolveEmbeddingRuntime({ EMBEDDING_PROVIDER: 'bogus' });
    expect(runtime.provider).toBe(DEFAULT_EMBEDDING_PROVIDER);
    expect(runtime.model).toBe(PROVIDER_DEFAULT_MODELS[DEFAULT_EMBEDDING_PROVIDER]);
  });

  it('treats blank EMBEDDING_MODEL as unset', () => {
    const runtime = resolveEmbeddingRuntime({ EMBEDDING_MODEL: '   ' });
    expect(runtime.model).toBe('nomic-embed-text');
  });
});
