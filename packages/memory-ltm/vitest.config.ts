import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages from source so tests don't require a prior build.
      '@engram/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@engram/embeddings': path.resolve(__dirname, '../../packages/embeddings/src/index.ts'),
      '@engram/redis': path.resolve(__dirname, '../../packages/redis/src/index.ts'),
      '@engram/memory-stm': path.resolve(__dirname, '../../packages/memory-stm/src/index.ts'),
      '@engram/vector-store': path.resolve(__dirname, '../../packages/vector-store/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
