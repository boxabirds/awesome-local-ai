/// <reference types="vitest/config" />
import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest 2.x workspace: two projects, unit (node) and component (jsdom).
export default defineWorkspace([
  {
    plugins: [react()],
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
      globals: true,
      setupFiles: ['tests/component/setup.ts'],
    },
  },
]);
