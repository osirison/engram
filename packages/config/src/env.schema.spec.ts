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
