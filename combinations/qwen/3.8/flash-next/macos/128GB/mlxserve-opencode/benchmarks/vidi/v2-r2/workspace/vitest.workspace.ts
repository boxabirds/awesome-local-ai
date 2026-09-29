import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineWorkspace([
  {
    plugins: [react()],
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.{test,spec}.ts'],
      globals: true,
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.{test,spec}.{ts,tsx}'],
      globals: true,
      setupFiles: ['./tests/component/setup.ts'],
    },
  },
]);
