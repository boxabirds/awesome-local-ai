import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects (design "Test scopes and boundaries"):
//   unit      - pure camera maths, node environment, no DOM
//   component - React components in jsdom (Vitest + Testing Library)
// E2E lives in Playwright (playwright.config.ts), not here.
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
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['./tests/component/setup.ts'],
        },
      },
    ],
  },
});
