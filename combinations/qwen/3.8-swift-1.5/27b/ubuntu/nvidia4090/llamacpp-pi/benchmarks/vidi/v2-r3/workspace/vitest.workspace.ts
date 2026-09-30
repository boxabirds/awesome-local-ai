import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.tsx'],
    },
  },
]);
