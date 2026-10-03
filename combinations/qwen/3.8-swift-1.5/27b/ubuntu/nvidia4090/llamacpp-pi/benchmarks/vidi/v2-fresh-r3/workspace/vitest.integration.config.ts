import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker/index.ts',
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['tests/integration/worker.test.ts', 'tests/integration/board-store.test.ts', 'tests/integration/persistent-room.test.ts'],
    testTimeout: 60000,
  },
});
