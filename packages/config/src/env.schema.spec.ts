import { describe, expect, it } from 'vitest';
import { envSchema, validateEnv } from './env.schema';
import { ZodError } from 'zod';

describe('envSchema', () => {
  describe('valid configurations', () => {
    it('should validate a complete valid configuration', () => {
      const config = {
        NODE_ENV: 'development',
        PORT: '3000',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      const result = envSchema.parse(config);

      expect(result).toEqual({
        NODE_ENV: 'development',
        PORT: 3000,
        DEPLOYMENT_PROFILE: 'enterprise',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
        EMBEDDING_PROVIDER: 'ollama',
        MCP_TRANSPORT: 'stdio',
        VECTOR_BACKEND: 'qdrant',
        STM_CONSOLIDATION_ACCESS_THRESHOLD: 3,
        STM_CONSOLIDATION_INTERVAL_MS: 300_000,
        STM_SWEEP_INTERVAL_MS: 600_000,
        MEMORY_DECAY_INTERVAL_MS: 86_400_000,
        MEMORY_DECAY_BATCH_SIZE: 100,
        MEMORY_DECAY_STALE_SCORE_THRESHOLD: 0.3,
        MEMORY_DECAY_PRUNE_SCORE_THRESHOLD: 0.15,
        MEMORY_DECAY_PRUNE_OLDER_THAN_DAYS: 30,
        MEMORY_DUPLICATE_THRESHOLD: 0.97,
        MEMORY_CONSOLIDATION_MERGE_THRESHOLD: 0.85,
        MEMORY_CONSOLIDATION_INTERVAL_MS: 0,
        MEMORY_CONTRADICTION_THRESHOLD: 0.8,
        MEMORY_CONTRADICTION_THRESHOLD_MAX: 0.97,
        MEMORY_CONTRADICTION_POLICY: 'flag',
        MEMORY_IMPORTANCE_HALF_LIFE_DAYS: 14,
        JWT_EXPIRES_IN: '7d',
        AUTH_REQUIRED: false,
        ALLOW_UNAUTHENTICATED_HTTP: false,
        RATE_LIMIT_ENABLED: false,
        RATE_LIMIT_WINDOW_SEC: 60,
        RATE_LIMIT_USER_RPM: 120,
        RATE_LIMIT_ORG_RPM: 6000,
        RATE_LIMIT_IP_RPM: 60,
      });
    });

    it('defaults EMBEDDING_PROVIDER to ollama and accepts the new embedding vars', () => {
      const base = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      expect(envSchema.parse(base).EMBEDDING_PROVIDER).toBe('ollama');
      expect(envSchema.parse(base).EMBEDDING_MODEL).toBeUndefined();
      expect(envSchema.parse(base).OLLAMA_URL).toBeUndefined();

      const full = envSchema.parse({
        ...base,
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'mxbai-embed-large',
        OLLAMA_URL: 'http://ollama.internal:11434',
      });
      expect(full.EMBEDDING_MODEL).toBe('mxbai-embed-large');
      expect(full.OLLAMA_URL).toBe('http://ollama.internal:11434');

      // openai remains a valid opt-in
      expect(envSchema.parse({ ...base, EMBEDDING_PROVIDER: 'openai' }).EMBEDDING_PROVIDER).toBe(
        'openai'
      );
    });

    it('rejects an invalid OLLAMA_URL and provider; treats empty strings as unset', () => {
      const base = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      expect(() => envSchema.parse({ ...base, OLLAMA_URL: 'not-a-url' })).toThrow(ZodError);
      // `z.string().url()` accepts a scheme-less host:port, but it fails at fetch
      // time in the Ollama provider — the transform must reject it at boot.
      expect(() => envSchema.parse({ ...base, OLLAMA_URL: 'localhost:11434' })).toThrow(ZodError);
      expect(() => envSchema.parse({ ...base, EMBEDDING_PROVIDER: 'bogus' })).toThrow(ZodError);

      // Compose-style empty defaults (`VAR: ${VAR:-}`) must read as unset.
      const emptied = envSchema.parse({ ...base, EMBEDDING_MODEL: '', OLLAMA_URL: '' });
      expect(emptied.EMBEDDING_MODEL).toBeUndefined();
      expect(emptied.OLLAMA_URL).toBeUndefined();
    });

    it('should use default values for NODE_ENV and PORT', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      const result = envSchema.parse(config);

      expect(result.NODE_ENV).toBe('development');
      expect(result.PORT).toBe(3000);
    });

    it('should coerce PORT to number', () => {
      const config = {
        PORT: '8080',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      const result = envSchema.parse(config);

      expect(result.PORT).toBe(8080);
      expect(typeof result.PORT).toBe('number');
    });

    it('should accept production environment', () => {
      const config = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      const result = envSchema.parse(config);

      expect(result.NODE_ENV).toBe('production');
    });

    it('should accept test environment', () => {
      const config = {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      const result = envSchema.parse(config);

      expect(result.NODE_ENV).toBe('test');
    });
  });

  describe('vector backend configuration', () => {
    const base = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      QDRANT_URL: 'http://localhost:6333',
    };

    it('should default VECTOR_BACKEND to qdrant', () => {
      const result = envSchema.parse(base);
      expect(result.VECTOR_BACKEND).toBe('qdrant');
    });

    it('should accept pgvector as a backend', () => {
      const result = envSchema.parse({ ...base, VECTOR_BACKEND: 'pgvector' });
      expect(result.VECTOR_BACKEND).toBe('pgvector');
    });

    it('should accept streamable-http as an MCP transport', () => {
      const result = envSchema.parse({ ...base, MCP_TRANSPORT: 'streamable-http' });
      expect(result.MCP_TRANSPORT).toBe('streamable-http');
    });

    it('should reject an unknown backend', () => {
      expect(() => envSchema.parse({ ...base, VECTOR_BACKEND: 'pinecone' })).toThrow(ZodError);
    });

    it('should coerce VECTOR_DIMENSIONS to a positive integer', () => {
      const result = envSchema.parse({ ...base, VECTOR_DIMENSIONS: '768' });
      expect(result.VECTOR_DIMENSIONS).toBe(768);
    });

    it('should reject a non-positive VECTOR_DIMENSIONS', () => {
      expect(() => envSchema.parse({ ...base, VECTOR_DIMENSIONS: '0' })).toThrow(ZodError);
    });

    it('should accept a custom VECTOR_COLLECTION', () => {
      const result = envSchema.parse({ ...base, VECTOR_COLLECTION: 'custom' });
      expect(result.VECTOR_COLLECTION).toBe('custom');
    });

    it('should coerce pgvector HNSW tuning values', () => {
      const result = envSchema.parse({
        ...base,
        PGVECTOR_HNSW_M: '16',
        PGVECTOR_HNSW_EF_CONSTRUCTION: '64',
        PGVECTOR_HNSW_EF_SEARCH: '100',
      });
      expect(result.PGVECTOR_HNSW_M).toBe(16);
      expect(result.PGVECTOR_HNSW_EF_CONSTRUCTION).toBe(64);
      expect(result.PGVECTOR_HNSW_EF_SEARCH).toBe(100);
    });

    it('should leave HNSW tuning values undefined by default', () => {
      const result = envSchema.parse(base);
      expect(result.PGVECTOR_HNSW_M).toBeUndefined();
      expect(result.PGVECTOR_HNSW_EF_CONSTRUCTION).toBeUndefined();
      expect(result.PGVECTOR_HNSW_EF_SEARCH).toBeUndefined();
    });

    it('should reject an out-of-range PGVECTOR_HNSW_M', () => {
      expect(() => envSchema.parse({ ...base, PGVECTOR_HNSW_M: '1' })).toThrow(ZodError);
      expect(() => envSchema.parse({ ...base, PGVECTOR_HNSW_M: '101' })).toThrow(ZodError);
    });

    it('should reject an out-of-range PGVECTOR_HNSW_EF_SEARCH', () => {
      expect(() => envSchema.parse({ ...base, PGVECTOR_HNSW_EF_SEARCH: '0' })).toThrow(ZodError);
    });
  });

  describe('invalid configurations', () => {
    it('should throw error when DATABASE_URL is missing', () => {
      const config = {
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      expect(() => envSchema.parse(config)).toThrow(ZodError);
    });

    it('should throw error when DATABASE_URL is not a valid URL', () => {
      const config = {
        DATABASE_URL: 'not-a-url',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      expect(() => envSchema.parse(config)).toThrow(ZodError);
    });

    it('should throw error when REDIS_URL is missing', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        QDRANT_URL: 'http://localhost:6333',
      };

      expect(() => envSchema.parse(config)).toThrow(ZodError);
    });

    it('should throw error when REDIS_URL is not a valid URL', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'invalid-url',
        QDRANT_URL: 'http://localhost:6333',
      };

      expect(() => envSchema.parse(config)).toThrow(ZodError);
    });

    it('should throw error when QDRANT_URL is missing', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
      };

      expect(() => envSchema.parse(config)).toThrow(ZodError);
    });

    it('should throw error when QDRANT_URL is not a valid URL', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'not-a-url',
      };

      expect(() => envSchema.parse(config)).toThrow(ZodError);
    });

    it('should throw error when NODE_ENV is invalid', () => {
      const config = {
        NODE_ENV: 'invalid',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      expect(() => envSchema.parse(config)).toThrow(ZodError);
    });

    it('should throw error when PORT is not a number', () => {
      const config = {
        PORT: 'not-a-number',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      expect(() => envSchema.parse(config)).toThrow(ZodError);
    });
  });

  describe('auth & rate limiting', () => {
    const base = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      QDRANT_URL: 'http://localhost:6333',
    };

    const secret = 'a-very-long-secret-key-of-at-least-32-characters';

    it('parses AUTH_REQUIRED truthy strings without the z.coerce.boolean footgun', () => {
      expect(
        envSchema.parse({ ...base, AUTH_REQUIRED: 'true', JWT_SECRET: secret }).AUTH_REQUIRED
      ).toBe(true);
      expect(
        envSchema.parse({ ...base, AUTH_REQUIRED: '1', JWT_SECRET: secret }).AUTH_REQUIRED
      ).toBe(true);
      // The string 'false' must NOT be coerced to true (the z.coerce.boolean footgun).
      expect(envSchema.parse({ ...base, AUTH_REQUIRED: 'false' }).AUTH_REQUIRED).toBe(false);
      expect(envSchema.parse({ ...base, AUTH_REQUIRED: '0' }).AUTH_REQUIRED).toBe(false);
    });

    it('requires a 32+ char JWT_SECRET when AUTH_REQUIRED=true', () => {
      expect(() => envSchema.parse({ ...base, AUTH_REQUIRED: 'true' })).toThrow(ZodError);
      expect(() =>
        envSchema.parse({ ...base, AUTH_REQUIRED: 'true', JWT_SECRET: 'short' })
      ).toThrow(ZodError);
      expect(
        envSchema.parse({
          ...base,
          AUTH_REQUIRED: 'true',
          JWT_SECRET: 'a-very-long-secret-key-of-at-least-32-characters',
        }).JWT_SECRET
      ).toHaveLength(48);
    });

    it('does not require JWT_SECRET when auth is disabled', () => {
      expect(() => envSchema.parse(base)).not.toThrow();
      expect(envSchema.parse(base).JWT_SECRET).toBeUndefined();
    });

    it('coerces rate-limit numbers and rejects non-positive limits', () => {
      const result = envSchema.parse({
        ...base,
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_USER_RPM: '300',
        RATE_LIMIT_WINDOW_SEC: '30',
      });
      expect(result.RATE_LIMIT_ENABLED).toBe(true);
      expect(result.RATE_LIMIT_USER_RPM).toBe(300);
      expect(result.RATE_LIMIT_WINDOW_SEC).toBe(30);
      expect(() => envSchema.parse({ ...base, RATE_LIMIT_USER_RPM: '0' })).toThrow(ZodError);
    });

    it('accepts a well-formed RATE_LIMIT_TOOL_OVERRIDES and rejects a malformed one', () => {
      expect(
        envSchema.parse({
          ...base,
          RATE_LIMIT_TOOL_OVERRIDES: '{"reindex_memories":{"limit":2,"windowSeconds":3600}}',
        }).RATE_LIMIT_TOOL_OVERRIDES
      ).toContain('reindex_memories');
      // Not JSON.
      expect(() => envSchema.parse({ ...base, RATE_LIMIT_TOOL_OVERRIDES: 'not-json' })).toThrow(
        ZodError
      );
      // Wrong shape (missing windowSeconds / non-positive).
      expect(() =>
        envSchema.parse({
          ...base,
          RATE_LIMIT_TOOL_OVERRIDES: '{"t":{"limit":0,"windowSeconds":60}}',
        })
      ).toThrow(ZodError);
    });

    it('validates OAUTH_REDIRECT_BASE_URL as a URL when present', () => {
      expect(
        envSchema.parse({ ...base, OAUTH_REDIRECT_BASE_URL: 'https://api.example.com' })
          .OAUTH_REDIRECT_BASE_URL
      ).toBe('https://api.example.com');
      expect(() => envSchema.parse({ ...base, OAUTH_REDIRECT_BASE_URL: 'not-a-url' })).toThrow(
        ZodError
      );
    });
  });

  describe('LTM lifecycle configuration', () => {
    const base = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      QDRANT_URL: 'http://localhost:6333',
    };

    it('applies defaults matching the services inline fallbacks', () => {
      const result = envSchema.parse(base);
      expect(result.MEMORY_DECAY_INTERVAL_MS).toBe(86_400_000);
      expect(result.MEMORY_DECAY_BATCH_SIZE).toBe(100);
      expect(result.MEMORY_DECAY_STALE_SCORE_THRESHOLD).toBe(0.3);
      expect(result.MEMORY_DECAY_PRUNE_SCORE_THRESHOLD).toBe(0.15);
      expect(result.MEMORY_DECAY_PRUNE_OLDER_THAN_DAYS).toBe(30);
      expect(result.MEMORY_DUPLICATE_THRESHOLD).toBe(0.97);
      expect(result.MEMORY_CONSOLIDATION_MERGE_THRESHOLD).toBe(0.85);
      expect(result.MEMORY_CONTRADICTION_THRESHOLD).toBe(0.8);
      expect(result.MEMORY_CONTRADICTION_THRESHOLD_MAX).toBe(0.97);
      expect(result.MEMORY_IMPORTANCE_HALF_LIFE_DAYS).toBe(14);
    });

    it('defaults the corpus-consolidation scheduler to OFF (review gate — the operator opts in, G3-T2)', () => {
      expect(envSchema.parse(base).MEMORY_CONSOLIDATION_INTERVAL_MS).toBe(0);
    });

    it('coerces a custom consolidation band and scheduler interval', () => {
      const result = envSchema.parse({
        ...base,
        MEMORY_CONSOLIDATION_MERGE_THRESHOLD: '0.9',
        MEMORY_CONSOLIDATION_INTERVAL_MS: '3600000',
      });
      expect(result.MEMORY_CONSOLIDATION_MERGE_THRESHOLD).toBe(0.9);
      expect(result.MEMORY_CONSOLIDATION_INTERVAL_MS).toBe(3_600_000);
    });

    it('rejects a merge threshold at or above the duplicate threshold (empty/inverted band)', () => {
      // Equal — the band [merge, duplicate) would be empty.
      expect(() =>
        envSchema.parse({ ...base, MEMORY_CONSOLIDATION_MERGE_THRESHOLD: '0.97' })
      ).toThrow(/must be strictly below MEMORY_DUPLICATE_THRESHOLD/);
      // Inverted relative to a lowered duplicate threshold.
      expect(() =>
        envSchema.parse({
          ...base,
          MEMORY_CONSOLIDATION_MERGE_THRESHOLD: '0.9',
          MEMORY_DUPLICATE_THRESHOLD: '0.88',
        })
      ).toThrow(ZodError);
      // A valid band below a lowered duplicate threshold still parses.
      expect(
        envSchema.parse({
          ...base,
          MEMORY_CONSOLIDATION_MERGE_THRESHOLD: '0.8',
          MEMORY_DUPLICATE_THRESHOLD: '0.88',
        }).MEMORY_CONSOLIDATION_MERGE_THRESHOLD
      ).toBe(0.8);
    });

    it('rejects out-of-range consolidation values', () => {
      expect(() =>
        envSchema.parse({ ...base, MEMORY_CONSOLIDATION_MERGE_THRESHOLD: '1.5' })
      ).toThrow(ZodError);
      expect(() => envSchema.parse({ ...base, MEMORY_CONSOLIDATION_INTERVAL_MS: '-1' })).toThrow(
        ZodError
      );
      expect(() =>
        envSchema.parse({ ...base, MEMORY_CONSOLIDATION_INTERVAL_MS: 'hourly' })
      ).toThrow(ZodError);
    });

    it('defaults the contradiction policy to flag (G3-T4 — both rows kept, none hidden)', () => {
      expect(envSchema.parse(base).MEMORY_CONTRADICTION_POLICY).toBe('flag');
    });

    it('accepts the supersede contradiction policy (latest-wins opt-in)', () => {
      expect(
        envSchema.parse({ ...base, MEMORY_CONTRADICTION_POLICY: 'supersede' })
          .MEMORY_CONTRADICTION_POLICY
      ).toBe('supersede');
      expect(
        envSchema.parse({ ...base, MEMORY_CONTRADICTION_POLICY: 'flag' })
          .MEMORY_CONTRADICTION_POLICY
      ).toBe('flag');
    });

    it('rejects an unknown contradiction policy', () => {
      expect(() => envSchema.parse({ ...base, MEMORY_CONTRADICTION_POLICY: 'llm' })).toThrow(
        ZodError
      );
      expect(() => envSchema.parse({ ...base, MEMORY_CONTRADICTION_POLICY: 'FLAG' })).toThrow(
        ZodError
      );
    });

    it('coerces string values and allows disabling the decay scheduler with 0', () => {
      const result = envSchema.parse({
        ...base,
        MEMORY_DECAY_INTERVAL_MS: '0',
        MEMORY_DUPLICATE_THRESHOLD: '0.95',
        MEMORY_IMPORTANCE_HALF_LIFE_DAYS: '30',
      });
      expect(result.MEMORY_DECAY_INTERVAL_MS).toBe(0);
      expect(result.MEMORY_DUPLICATE_THRESHOLD).toBe(0.95);
      expect(result.MEMORY_IMPORTANCE_HALF_LIFE_DAYS).toBe(30);
    });

    it('rejects a similarity threshold above 1', () => {
      expect(() => envSchema.parse({ ...base, MEMORY_DUPLICATE_THRESHOLD: '1.5' })).toThrow(
        ZodError
      );
      expect(() => envSchema.parse({ ...base, MEMORY_CONTRADICTION_THRESHOLD: '2' })).toThrow(
        ZodError
      );
    });

    it('rejects a non-numeric or non-positive lifecycle value', () => {
      expect(() => envSchema.parse({ ...base, MEMORY_DECAY_BATCH_SIZE: 'lots' })).toThrow(ZodError);
      expect(() => envSchema.parse({ ...base, MEMORY_IMPORTANCE_HALF_LIFE_DAYS: '0' })).toThrow(
        ZodError
      );
      expect(() => envSchema.parse({ ...base, MEMORY_DECAY_INTERVAL_MS: '-1' })).toThrow(ZodError);
    });
  });

  describe('import path allowlist (IMPORT_ALLOWED_ROOT, A18)', () => {
    const base = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      QDRANT_URL: 'http://localhost:6333',
    };

    it('is optional and stays undefined when unset (runtime falls back to the home dir)', () => {
      const result = envSchema.parse(base);
      expect(result.IMPORT_ALLOWED_ROOT).toBeUndefined();
    });

    it('accepts an absolute POSIX path', () => {
      const result = envSchema.parse({ ...base, IMPORT_ALLOWED_ROOT: '/srv/engram/imports' });
      expect(result.IMPORT_ALLOWED_ROOT).toBe('/srv/engram/imports');
    });

    it('accepts an absolute Windows drive path', () => {
      const result = envSchema.parse({ ...base, IMPORT_ALLOWED_ROOT: 'C:\\engram\\imports' });
      expect(result.IMPORT_ALLOWED_ROOT).toBe('C:\\engram\\imports');
    });

    it('rejects a relative path', () => {
      expect(() => envSchema.parse({ ...base, IMPORT_ALLOWED_ROOT: 'imports' })).toThrow(ZodError);
      expect(() => envSchema.parse({ ...base, IMPORT_ALLOWED_ROOT: './imports' })).toThrow(
        ZodError
      );
    });

    it('rejects an empty string', () => {
      expect(() => envSchema.parse({ ...base, IMPORT_ALLOWED_ROOT: '' })).toThrow(ZodError);
    });
  });

  describe('validateEnv', () => {
    it('should validate valid configuration', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
      };

      const result = validateEnv(config);

      expect(result).toBeDefined();
      expect(result.NODE_ENV).toBe('development');
      expect(result.PORT).toBe(3000);
    });

    it('should throw ZodError for invalid configuration', () => {
      const config = {
        DATABASE_URL: 'invalid',
      };

      expect(() => validateEnv(config)).toThrow(ZodError);
    });
  });
});
