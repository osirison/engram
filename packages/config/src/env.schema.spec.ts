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
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        QDRANT_URL: 'http://localhost:6333',
        EMBEDDING_PROVIDER: 'openai',
        VECTOR_BACKEND: 'qdrant',
      });
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
