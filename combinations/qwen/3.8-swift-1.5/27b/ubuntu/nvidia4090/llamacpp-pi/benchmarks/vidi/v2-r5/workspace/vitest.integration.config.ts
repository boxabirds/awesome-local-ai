import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
});
