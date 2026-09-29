import { defineWorkspace } from 'vitest/config';
import { resolve } from 'path';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**'],
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@client': resolve(__dirname, 'src/client'),
      },
    },
  },
  {
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**'],
      setupFiles: ['tests/setup.ts'],
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@client': resolve(__dirname, 'src/client'),
      },
    },
  },
]);
