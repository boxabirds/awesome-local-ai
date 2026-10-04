import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { defineWorkspace } from 'vitest/config';

// Three projects per the design's "vitest.config.ts projects" intent.
// Vitest 2.x expresses projects via a workspace file; `--project unit|component|integration`
// selects them.
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'component',
      environment: 'jsdom',
      globals: true,
      include: ['tests/component/**/*.test.tsx'],
      setupFiles: ['tests/component/setup.ts'],
    },
  },
  // Integration tests run inside the Workers runtime (workerd) against the real
  // Worker entry, real Durable Objects and real WebSockets.
  defineWorkersProject({
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      pool: '@cloudflare/vitest-pool-workers',
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          // Storage is in memory only in this story; boards are keyed by a fresh
          // random id per test, so tests may share one instance state.
          isolatedStorage: false,
          singleWorker: true,
        },
      },
    },
  }),
]);
