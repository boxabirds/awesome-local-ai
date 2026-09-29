import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Integration tests run inside workerd with the real Worker, the real BoardRoom Durable Object and the
// built client assets (`npm run test:integration` builds them first).
export default defineConfig({
  plugins: [cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // The pool's bundled workerd trails the wrangler one by a few days.
      // The test runner itself needs Node.js APIs in workerd.
      miniflare: { compatibilityDate: '2026-08-22', compatibilityFlags: ['nodejs_compat'] },
    })],
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
