import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

/**
 * The same worker as the integration project, but started from
 * wrangler.hooks.jsonc so the test-only storage routes are enabled.
 */
export default defineWorkersProject({
  test: {
    name: 'hooks',
    include: ['tests/hooks/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.hooks.jsonc' },
        minify: false,
        singleWorker: true,
        isolatedStorage: false,
      },
    },
  },
});
