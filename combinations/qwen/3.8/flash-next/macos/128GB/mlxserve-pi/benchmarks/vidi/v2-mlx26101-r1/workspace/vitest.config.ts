import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects: pure-logic unit tests in a node environment and DOM component
// tests in jsdom. `npm run test:unit` / `npm run test:component` select a
// single project; a bare `vitest run` runs both.
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
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
});
