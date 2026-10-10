/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

/**
 * Integration project (anchor `sync.worker_entry`, `sync.room`).
 *
 * Tests run *inside* the Workers runtime (workerd via `@cloudflare/vitest-plugin`,
 * the package that replaced `@cloudflare/vitest-pool-workers`) against the real
 * `wrangler.jsonc`: the real `fetch` handler, a real Durable Object namespace
 * and real WebSockets. Nothing about the room is mocked.
 *
 * `npm run pretest:integration` builds the client first, because the
 * configuration under test serves it as static assets.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
  },
});
