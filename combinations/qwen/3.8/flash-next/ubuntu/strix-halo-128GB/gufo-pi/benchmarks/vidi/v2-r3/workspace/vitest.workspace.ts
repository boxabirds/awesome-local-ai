import { defineWorkspace } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
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
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.{test,spec}.ts'],
      environment: 'node',
      globalSetup: ['tests/integration/global-setup.ts'],
      testTimeout: 30000,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      teardownTimeout: 5000,
      passWithNoTests: true,
    },
  },
  defineWorkersProject({
    test: {
      name: 'integration-do',
      include: ['tests/integration-do/**/*.{test,spec}.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          main: './src/worker/index.ts',
          wrangler: { configPath: './wrangler.jsonc' },
        },
      },
      testTimeout: 30000,
    },
  }),
]);
