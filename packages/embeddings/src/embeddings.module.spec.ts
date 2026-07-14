import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { EmbeddingsModule } from './embeddings.module';
import { EMBEDDING_RUNTIME_TOKEN, type EmbeddingRuntime } from './embedding-runtime';
import { EMBEDDING_PROVIDER_TOKEN } from './providers/provider.tokens';
import { OllamaEmbeddingProvider } from './providers/ollama-embedding.provider';
import { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider';
import { LocalEmbeddingProvider } from './providers/local-embedding.provider';

const ENV_KEYS = ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL', 'VECTOR_DIMENSIONS'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

describe('EmbeddingsModule wiring', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  async function resolveModule() {
    return Test.createTestingModule({ imports: [EmbeddingsModule] }).compile();
  }

  it('selects the Ollama provider by default', async () => {
    const moduleRef = await resolveModule();
    expect(moduleRef.get(EMBEDDING_PROVIDER_TOKEN)).toBeInstanceOf(OllamaEmbeddingProvider);
    await moduleRef.close();
  });

  it('provides a runtime resolving to nomic-embed-text at 768 dims by default', async () => {
    const moduleRef = await resolveModule();
    const runtime = moduleRef.get<EmbeddingRuntime>(EMBEDDING_RUNTIME_TOKEN);
    expect(runtime).toEqual({ provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 });
    await moduleRef.close();
  });

  it('still selects the OpenAI provider when EMBEDDING_PROVIDER=openai', async () => {
    process.env['EMBEDDING_PROVIDER'] = 'openai';
    const moduleRef = await resolveModule();
    expect(moduleRef.get(EMBEDDING_PROVIDER_TOKEN)).toBeInstanceOf(OpenAIEmbeddingProvider);
    await moduleRef.close();
  });

  it('selects the local hash provider when EMBEDDING_PROVIDER=local', async () => {
    process.env['EMBEDDING_PROVIDER'] = 'local';
    const moduleRef = await resolveModule();
    expect(moduleRef.get(EMBEDDING_PROVIDER_TOKEN)).toBeInstanceOf(LocalEmbeddingProvider);
    await moduleRef.close();
  });
});
