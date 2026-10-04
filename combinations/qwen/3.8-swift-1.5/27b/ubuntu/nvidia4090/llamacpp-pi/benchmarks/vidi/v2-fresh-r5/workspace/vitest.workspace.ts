import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two test projects: pure-logic unit tests (node) and DOM component tests
// (jsdom). Each project uses the React plugin for JSX transformation.
export default defineWorkspace([
  // workerd-backed integration project (real Worker + Durable Objects).
  'vitest.integration.config.ts',
  {
    plugins: react(),
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    },
  },
  {
    plugins: react(),
    test: {
      name: 'component',
      environment: 'jsdom',
      globals: true,
      include: ['tests/component/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['tests/component/setup.ts'],
    },
  },
]);
