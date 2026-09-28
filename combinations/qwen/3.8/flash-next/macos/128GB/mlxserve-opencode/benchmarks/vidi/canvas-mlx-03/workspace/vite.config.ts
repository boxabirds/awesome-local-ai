import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          root: '.',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'component',
          environment: 'jsdom',
          root: '.',
          include: ['tests/component/**/*.test.tsx'],
          globals: true,
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
});
