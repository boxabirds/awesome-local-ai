import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const migrations = await readD1Migrations(root('../../migrations'));

// Base wrangler environment only (never `environment: 'staging' | 'production'`):
// D1 is Miniflare-local, so tests can never reach real data.
const workers = (bindings: Record<string, unknown> = {}) =>
  cloudflareTest({
    wrangler: { configPath: root('../../wrangler.toml') },
    miniflare: { bindings: { TEST_MIGRATIONS: migrations, ...bindings } },
  });

export default defineConfig({
  test: {
    root: root('.'),
    globalSetup: [root('./test/global-setup.ts')],
    projects: [
      {
        plugins: [workers()],
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        plugins: [workers()],
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        plugins: [
          workers({ ENVIRONMENT: 'production', TEST_SIMULATED_ENVIRONMENT: 'production' }),
        ],
        test: {
          name: 'production-gate',
          include: ['test/production/**/*.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
    ],
  },
});
