import { describe, it, expect, vi } from 'vitest';
import type { EmbeddingProvider } from './embedding-provider.interface.js';
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
    openai: mockProvider('openai'),
    disabled: mockProvider('disabled'),
    local: mockProvider('local'),
  };

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
});
