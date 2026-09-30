import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Three projects: pure maths in node, DOM/component tests in jsdom, and Worker +
// Durable Object integration tests in the workerd runtime (`@cloudflare/
// vitest-pool-workers`, booting `wrangler.jsonc`).
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
          setupFiles: ['./tests/component/setup.ts'],
        },
      },
      {
        // Worker integration runs in workerd, not node/jsdom, so it gets its own
        // plugin (which selects the workers pool) rather than extending the React
        // browser config above.
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
