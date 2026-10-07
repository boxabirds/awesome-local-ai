import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'component',
    include: ['tests/component/**/*.test.tsx', 'tests/component/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
  },
});
