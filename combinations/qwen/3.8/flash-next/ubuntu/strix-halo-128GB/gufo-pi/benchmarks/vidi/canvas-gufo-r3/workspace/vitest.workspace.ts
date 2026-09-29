import { defineWorkspace } from 'vitest/config';
import path from 'path';

const alias = {
  '@shared': path.resolve(__dirname, 'src/shared'),
  '@client': path.resolve(__dirname, 'src/client'),
};

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/component/setup.ts'],
    },
  },
]);
