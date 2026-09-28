import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const alias = {
  'src': path.resolve(__dirname, 'src'),
};

export default defineWorkspace([
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
    },
  },
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/component/setup.ts'],
    },
  },
]);
