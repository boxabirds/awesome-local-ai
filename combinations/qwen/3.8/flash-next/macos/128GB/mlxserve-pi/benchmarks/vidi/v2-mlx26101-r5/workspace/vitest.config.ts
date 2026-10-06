import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Keep the React runtime in "development" mode for tests so act() works.
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          // `tests/unit-workers` is the Worker's own unit tests: pure functions from
          // `src/worker`, type-checked against the Workers types, run in this same
          // project because they need no runtime around them.
          include: ['tests/unit/**/*.test.ts', 'tests/unit-workers/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      {
        // The real Worker: the tests run inside workerd against `wrangler.jsonc`,
        // so routing, Durable Objects, WebSockets and Yjs merging are all the
        // genuine article. The plugin switches this project onto the Workers pool.
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
