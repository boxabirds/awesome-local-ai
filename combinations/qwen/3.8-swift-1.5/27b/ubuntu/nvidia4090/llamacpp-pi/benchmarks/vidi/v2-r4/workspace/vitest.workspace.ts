import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
    },
  },
  {
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.{ts,tsx}'],
    },
  },
  {
    test: {
      name: 'integration',
      environment: 'node',
      include: ['tests/integration/**/*.test.{ts,tsx}'],
      testTimeout: 30000,
      hookTimeout: 120000,
      fileParallelism: false,
      globalSetup: ['tests/integration/global-setup.ts'],
    },
  },
]);
