import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Integration project: real Worker + Durable Objects in workerd (no mocks).
// The Worker under test is configured by wrangler.jsonc.
export default defineWorkersConfig({
  test: {
    name: 'integration',
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        wrangler: { configPath: 'wrangler.jsonc' },
        // DO instances (and their SQLite handles) outlive individual tests,
        // which the per-test isolated-storage pop cannot reconcile. Each test
        // uses fresh board ids, so shared storage is safe here.
        isolatedStorage: false,
      },
    },
    include: ['tests/integration/**/*.{test,spec}.ts'],
  },
});
