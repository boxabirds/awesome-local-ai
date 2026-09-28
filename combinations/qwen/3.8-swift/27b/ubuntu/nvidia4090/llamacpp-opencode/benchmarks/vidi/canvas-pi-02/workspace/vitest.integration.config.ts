// Vitest config for the Workers integration tests: real BoardRoom Durable
// Object + real WebSockets + real Yjs docs, running inside the Workers
// runtime (workerd) via @cloudflare/vitest-pool-workers. No mocks.
//
// Run with `npm run test:integration`.

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: 'wrangler.jsonc' } })],
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    // The cloudflare pool (set by the plugin) runs tests in workerd.
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
