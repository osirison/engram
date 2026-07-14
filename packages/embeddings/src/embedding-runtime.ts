import { Logger } from '@nestjs/common';
import { MODEL_DIMENSIONS } from './types.js';
import {
  DEFAULT_EMBEDDING_PROVIDER,
  type EmbeddingProviderName,
} from './providers/provider.tokens.js';

/** Default model per provider, used when EMBEDDING_MODEL is not set. */
export const PROVIDER_DEFAULT_MODELS: Record<EmbeddingProviderName, string> = {
  ollama: 'nomic-embed-text',
  openai: 'text-embedding-3-small',
  local: 'local-hash',
  disabled: 'disabled',
};

/**
 * Resolved embedding configuration for the current process.
 * Injected via {@link EMBEDDING_RUNTIME_TOKEN} so the service, providers, and
 * scripts all agree on the effective provider, model, and dimensionality.
 */
export interface EmbeddingRuntime {
  provider: EmbeddingProviderName;
  /** Effective model id: EMBEDDING_MODEL env, else the provider's default. */
  model: string;
  /**
   * Effective dimensionality: VECTOR_DIMENSIONS env, else the known dimension
   * of the model, else undefined (dimensions then flow from the provider's
   * actual output vector).
   */
  dimensions?: number;
}

export const EMBEDDING_RUNTIME_TOKEN = 'EMBEDDING_RUNTIME_TOKEN';

const KNOWN_PROVIDERS: readonly EmbeddingProviderName[] = ['ollama', 'openai', 'disabled', 'local'];

const logger = new Logger('EmbeddingRuntime');

/**
 * Resolve the effective embedding runtime from the environment. Pure aside
 * from a warning log on unknown provider names, which normalize to
 * {@link DEFAULT_EMBEDDING_PROVIDER}.
 */
export function resolveEmbeddingRuntime(
  env: Record<string, string | undefined> = process.env
): EmbeddingRuntime {
  const rawProvider = env['EMBEDDING_PROVIDER']?.trim();
  let provider: EmbeddingProviderName;
  if (!rawProvider) {
    provider = DEFAULT_EMBEDDING_PROVIDER;
  } else if ((KNOWN_PROVIDERS as readonly string[]).includes(rawProvider)) {
    provider = rawProvider as EmbeddingProviderName;
  } else {
    logger.warn(
      JSON.stringify({
        event: 'embedding.runtime.unknown_provider',
        provider: rawProvider,
        fallback: DEFAULT_EMBEDDING_PROVIDER,
      })
    );
    provider = DEFAULT_EMBEDDING_PROVIDER;
  }

  const model = env['EMBEDDING_MODEL']?.trim() || PROVIDER_DEFAULT_MODELS[provider];

  const rawDimensions = Number.parseInt(env['VECTOR_DIMENSIONS'] ?? '', 10);
  const dimensions =
    Number.isInteger(rawDimensions) && rawDimensions > 0 ? rawDimensions : MODEL_DIMENSIONS[model];

  return dimensions !== undefined ? { provider, model, dimensions } : { provider, model };
}
