import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects: pure maths in node, DOM/component tests in jsdom.
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
