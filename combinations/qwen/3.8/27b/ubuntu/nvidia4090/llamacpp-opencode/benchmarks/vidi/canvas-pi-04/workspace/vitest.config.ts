import { defineConfig } from 'vitest/config';

// Two Vitest projects:
//  - `unit`: pure logic (camera maths) in a plain node environment.
//  - `component`: React components with Testing Library in jsdom.
// E2E tests (Playwright) are configured separately in playwright.config.ts.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.{test,spec}.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.{test,spec}.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
});
