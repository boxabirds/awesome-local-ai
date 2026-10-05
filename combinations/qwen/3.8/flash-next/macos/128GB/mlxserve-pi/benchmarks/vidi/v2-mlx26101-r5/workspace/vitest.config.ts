import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Keep the React runtime in "development" mode for tests so act() works.
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
});
