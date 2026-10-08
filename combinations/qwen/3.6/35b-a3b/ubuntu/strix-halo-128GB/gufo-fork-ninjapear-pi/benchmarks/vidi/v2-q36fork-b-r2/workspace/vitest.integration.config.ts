import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    poolOptions: {
      threads: { singleThread: true },
    },
    testTimeout: 30_000,
  },
});
