import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects: pure-unit tests run in node; component tests run in jsdom.
// There is no integration/request-handling boundary in story 1 (no server code).
export default defineConfig({
  plugins: [react()],
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
          include: ['tests/component/**/*.test.{ts,tsx}'],
          globals: false,
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
});
