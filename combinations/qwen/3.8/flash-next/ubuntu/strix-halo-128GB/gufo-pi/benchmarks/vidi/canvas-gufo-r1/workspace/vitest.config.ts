import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two Vitest projects:
//  - unit: pure node tests (camera maths).
//  - component: jsdom + Testing Library (viewport, controls, hint).
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
