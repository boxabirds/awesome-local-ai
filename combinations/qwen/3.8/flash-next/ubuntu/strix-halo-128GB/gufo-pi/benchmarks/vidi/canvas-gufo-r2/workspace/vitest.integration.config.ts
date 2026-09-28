import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        minify: false,
        singleWorker: true,
        isolatedStorage: false,
      },
    },
  },
});
