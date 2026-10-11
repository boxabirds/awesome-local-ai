import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Integration project (`npm run test:integration`).
 *
 * These tests run inside the Workers runtime against the real wrangler config,
 * so the BoardRoom binding, the Durable Object migration and the assets binding
 * are the ones `wrangler dev` and `wrangler deploy` use
 * (`tests/integration/README.md`).
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Everything the tests need is local: no network binding lookups.
      remoteBindings: false,
      verbose: true,
    }),
  ],
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
