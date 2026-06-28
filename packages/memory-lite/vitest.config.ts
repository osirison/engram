import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@engram/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
