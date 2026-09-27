import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'integration',
          environment: 'node',
          // Real Y.Doc clients speaking the y-protocols over real WebSockets
          // against a real workerd instance (`wrangler dev`, started by the
          // global setup below on port 8790). No mocks anywhere in the stack.
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      defineWorkersProject({
        test: {
          name: 'workers',
          include: ['tests/workers/**/*.test.ts'],
          pool: '@cloudflare/vitest-pool-workers',
          poolOptions: {
            workers: {
              wrangler: { configPath: './tests/workers/wrangler.jsonc' },
            },
          },
        },
      }),
    ],
  },
});
