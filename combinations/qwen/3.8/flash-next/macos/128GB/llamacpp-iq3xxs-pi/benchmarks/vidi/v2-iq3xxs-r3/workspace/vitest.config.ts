import react from '@vitejs/plugin-react';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

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
          include: ['tests/component/**/*.test.ts', 'tests/component/**/*.test.tsx'],
          setupFiles: ['./tests/component/setup.ts'],
        },
      },
      {
        // The Worker and the BoardRoom Durable Object run inside real workerd
        // (no mocks): `SELF.fetch` reaches the `fetch` handler in
        // `wrangler.jsonc`, sockets and close codes included.
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          // Real sockets and real handshakes: the waits below are in seconds,
          // so a hung exchange must be reported as a failure with its own
          // message instead of as a generic test timeout.
          testTimeout: 60_000,
        },
      },
    ],
  },
});
