import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The workerd bundled with @cloudflare/vitest-pool-workers is older than wrangler's and
 * refuses wrangler.jsonc's compatibility_date; integration tests run at the newest date it
 * supports. Nothing this app uses changed between the two dates.
 */
const POOL_WORKERD_COMPATIBILITY_DATE = '2026-08-22';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      {
        // The real Worker and BoardRoom Durable Object in workerd, configured from wrangler.jsonc.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: { compatibilityDate: POOL_WORKERD_COMPATIBILITY_DATE },
          }),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});
