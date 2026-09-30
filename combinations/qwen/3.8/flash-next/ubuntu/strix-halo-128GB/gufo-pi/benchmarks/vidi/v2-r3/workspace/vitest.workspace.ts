import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'component',
      include: ['tests/component/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
      globals: true,
      setupFiles: ['tests/component/setup.ts'],
    },
  },
]);
