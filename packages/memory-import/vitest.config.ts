import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages from source so tests don't require a prior build.
      '@engram/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
      '@engram/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@engram/embeddings': path.resolve(__dirname, '../../packages/embeddings/src/index.ts'),
      '@engram/memory-interchange': path.resolve(
        __dirname,
        '../../packages/memory-interchange/src/index.ts'
      ),
      '@engram/memory-ltm': path.resolve(__dirname, '../../packages/memory-ltm/src/index.ts'),
      '@engram/memory-stm': path.resolve(__dirname, '../../packages/memory-stm/src/index.ts'),
      '@engram/redis': path.resolve(__dirname, '../../packages/redis/src/index.ts'),
      '@engram/vector-store': path.resolve(__dirname, '../../packages/vector-store/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    globals: true,
    environment: 'node',
  },
});
