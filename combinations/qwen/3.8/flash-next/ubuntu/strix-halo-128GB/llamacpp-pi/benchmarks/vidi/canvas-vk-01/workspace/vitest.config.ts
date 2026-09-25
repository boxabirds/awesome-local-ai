import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vitest projects: `unit` runs in node (pure maths), `component` runs in jsdom.
// The react plugin is needed so JSX in tests/component is transformed.
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
          include: ['tests/component/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: ['./tests/component/setup.ts'],
        },
      },
    ],
  },
});
