import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects: `unit` (pure maths, node) and `component` (jsdom + Testing Library).
// E2E tests live in tests/e2e and run under Playwright (`npm run test:e2e`).
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
          setupFiles: ['./tests/component/setup.ts'],
        },
      },
    ],
  },
});
