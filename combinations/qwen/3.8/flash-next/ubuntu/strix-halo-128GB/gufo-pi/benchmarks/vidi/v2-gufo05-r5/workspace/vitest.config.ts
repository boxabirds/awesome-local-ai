import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Three projects: `unit` (pure maths, node), `component` (jsdom + Testing Library) and
// `integration` (the Worker and its Durable Object inside the real workerd runtime).
// E2E tests live in tests/e2e and run under Playwright (`npm run test:e2e`).
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
        // The Worker entry and BoardRoom run inside workerd (real WebSockets, real Durable
        // Objects, real assets handler) - see tests/integration. The `cloudflareTest`
        // plugin installs the Workers pool runner for this project only.
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});
