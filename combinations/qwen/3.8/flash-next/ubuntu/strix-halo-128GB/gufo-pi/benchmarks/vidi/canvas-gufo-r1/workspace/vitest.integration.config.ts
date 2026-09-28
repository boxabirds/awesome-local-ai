import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    fileParallelism: false,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        isolatedStorage: false,
      },
    },
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
