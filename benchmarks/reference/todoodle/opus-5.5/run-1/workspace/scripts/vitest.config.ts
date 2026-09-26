import { defineConfig } from 'vitest/config';

// Deploy tooling tests run in the node pool (they drive git, the filesystem and HTTP).
export default defineConfig({
  test: {
    root: import.meta.dirname + '/..',
    environment: 'node',
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'deploy-unit',
          include: ['scripts/test/**/*.test.ts'],
          exclude: ['scripts/test/**/*.int.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'deploy-integration',
          include: ['scripts/test/**/*.int.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
