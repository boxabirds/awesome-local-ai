import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.{test,spec}.ts'],
    testTimeout: 30000,
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        main: 'src/worker/index.ts',
        wrangler: {
          configPath: 'wrangler.jsonc',
        },
        isolatedStorage: false,
      },
    },
  },
});
