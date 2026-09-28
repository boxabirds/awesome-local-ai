import { defineConfig } from 'vitest/config';

// Two projects: pure node unit tests and jsdom component tests.
// Integration tests run in workerd with a separate config (vitest.integration.config.ts).
// E2E tests live in tests/e2e and run under Playwright, never Vitest.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
});
