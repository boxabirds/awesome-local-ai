import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default project: unit tests (node environment)
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
