// Vitest config for vidi6.
//
// Two projects here: `unit` (fast, node environment) and `component`
// (component tests in jsdom). Worker/room integration tests run in the
// Workers runtime under a separate config: vitest.integration.config.ts
// (run with `npm run test:integration`).

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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
          testTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          setupFiles: ['tests/component/setup.ts'],
          include: ['tests/component/**/*.test.tsx'],
        },
      },
    ],
  },
});
