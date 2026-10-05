import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two Vitest projects: pure logic in `node`, React components in `jsdom`.
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx']
        }
      }
    ]
  }
});
