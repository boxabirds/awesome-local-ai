import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**'],
    },
  },
  {
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**'],
      setupFiles: ['tests/setup.ts'],
    },
  },
]);
