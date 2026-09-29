import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Three projects, each running against the real boundary it exercises
 * (design "Mock vs real boundaries"):
 *  - `unit`: pure functions in Node.
 *  - `component`: React under jsdom, no network.
 *  - `integration`: the Worker and the BoardRoom Durable Object run inside
 *    workerd (via `@cloudflare/vitest-pool-workers`) against the same
 *    `wrangler.jsonc` the app deploys with, so the tests hit the real
 *    Durable Object + WebSocket stack, not a mock.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
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
        extends: true,
        plugins: [
          cloudflareTest({
            // Derive the Worker entrypoint, Durable Object binding and assets
            // from the app's real `wrangler.jsonc`, so the tests hit the same
            // Durable Object + WebSocket + assets stack as deployment.
            wrangler: { configPath: './wrangler.jsonc' },
            // Bindings stay local (no remote / no session token needed).
            remoteBindings: false,
          }),
        ],
        test: {
          name: 'integration',
          pool: 'cloudflare',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});