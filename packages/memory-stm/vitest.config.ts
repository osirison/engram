import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@engram/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@engram/embeddings': path.resolve(__dirname, '../../packages/embeddings/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
