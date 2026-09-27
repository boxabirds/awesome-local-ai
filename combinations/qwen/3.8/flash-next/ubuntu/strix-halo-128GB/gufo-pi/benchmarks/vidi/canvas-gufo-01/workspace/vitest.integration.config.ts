import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';

const poolOptions = {
  wrangler: { configPath: './wrangler.jsonc' },
  isolatedStorage: true,
};

// Integration tests run inside workerd against the real Worker + BoardRoom
// Durable Object (SQLite storage) described by wrangler.jsonc. The assets
// directory must exist, so `npm run build` runs first (pretest:integration).
export default defineConfig({
  plugins: [cloudflareTest(poolOptions)],
  test: {
    pool: cloudflarePool(poolOptions),
    include: ['tests/integration/**/*.test.ts'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
