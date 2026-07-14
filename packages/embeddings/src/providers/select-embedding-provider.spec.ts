import { describe, it, expect, vi } from 'vitest';
import type { EmbeddingProvider } from './embedding-provider.interface.js';
import type { EmbeddingProviderName } from './provider.tokens.js';
import { selectEmbeddingProvider } from './select-embedding-provider.js';

function mockProvider(name: string): EmbeddingProvider {
  return {
    generate: vi.fn(async () => {
      return [name.length];
    }),
  };
}

describe('selectEmbeddingProvider', () => {
  const providers = {
    ollama: mockProvider('ollama'),
    openai: mockProvider('openai'),
    disabled: mockProvider('disabled'),
    local: mockProvider('local'),
  };

  it('returns ollama provider for ollama mode', () => {
    const selected = selectEmbeddingProvider('ollama', providers);
    expect(selected).toBe(providers.ollama);
  });

  it('returns openai provider for openai mode', () => {
    const selected = selectEmbeddingProvider('openai', providers);
    expect(selected).toBe(providers.openai);
  });

  it('returns disabled provider for disabled mode', () => {
    const selected = selectEmbeddingProvider('disabled', providers);
    expect(selected).toBe(providers.disabled);
  });

  it('returns local provider for local mode', () => {
    const selected = selectEmbeddingProvider('local', providers);
    expect(selected).toBe(providers.local);
  });

  it('falls back to ollama for unrecognized values', () => {
    const selected = selectEmbeddingProvider('unknown' as EmbeddingProviderName, providers);
    expect(selected).toBe(providers.ollama);
  });
});
