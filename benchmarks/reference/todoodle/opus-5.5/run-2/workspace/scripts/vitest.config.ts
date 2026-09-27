import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('..', import.meta.url));

// Node pool: deploy tooling runs under bun/node, never inside workerd.
export default defineConfig({
  test: {
    root,
    projects: [
      {
        test: {
          name: 'unit',
          root,
          environment: 'node',
          include: ['scripts/test/**/*.test.ts', 'e2e/**/*.unit.test.ts', 'packages/shared/test/**/*.test.ts'],
          exclude: ['scripts/test/**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          root,
          environment: 'node',
          include: ['scripts/test/**/*.int.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
