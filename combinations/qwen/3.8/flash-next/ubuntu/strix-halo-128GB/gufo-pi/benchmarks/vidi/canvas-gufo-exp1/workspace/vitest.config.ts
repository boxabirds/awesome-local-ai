import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two Vitest projects: `unit` (pure logic, node) and `component` (jsdom + Testing Library).
// E2E tests are Playwright and are not part of Vitest (see playwright.config.ts).
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
          setupFiles: ['tests/setup/component.ts'],
        },
      },
    ],
  },
});
