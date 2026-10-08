import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
    },
  },
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.ts'],
    environment: 'node',
    globals: true,
    hookTimeout: 60_000,
    testTimeout: 90_000,
  },
});
