/// <reference types="vitest/config" />
import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

// Vitest 2.x workspace. `unit` (node) and `component` (jsdom) run in the normal
// pool; `integration` runs inside the real Workers runtime (workerd) via the
// @cloudflare/vitest-pool-workers pool against wrangler.jsonc.
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
  defineWorkersProject({
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      testTimeout: 30000,
      hookTimeout: 30000,
      poolOptions: {
        workers: {
          isolatedStorage: false,
          singleWorker: true,
          wrangler: { configPath: './wrangler.jsonc' },
        },
      },
    },
  }),
]);
