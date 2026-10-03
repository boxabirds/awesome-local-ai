import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      {
        // Real workerd via the Cloudflare workers pool (no mocks): worker
        // routing and the BoardRoom live relay (real Durable Object + real
        // WebSockets + real Yjs, driven in-process via SELF.fetch).
        // The cloudflareTest plugin (project scoped) wires up the pool runner,
        // workerd resolve conditions and snapshot environment for vitest 4.
        plugins: [cloudflareTest({ wrangler: { configPath: 'wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
