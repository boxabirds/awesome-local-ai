import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two Vitest projects: pure `unit` (node) and `component` (jsdom + Testing Library).
// E2E tests run under Playwright (see playwright.config.ts), not Vitest.
export default defineConfig({
  plugins: [react()],
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
