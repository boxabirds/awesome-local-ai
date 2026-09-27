import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

/**
 * Integration project: the real entry Worker, `BoardRoom` Durable Object and WebSockets
 * run inside workerd (`@cloudflare/vitest-pool-workers`). The room is the unit under
 * test, so it is never mocked. The project is wired into `vitest.config.ts` as a
 * referenced config file (run with `vitest run --project integration`).
 */
export default defineWorkersConfig({
  test: {
    name: 'integration',
    pool: '@cloudflare/vitest-pool-workers',
    include: ['tests/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        // DO SQLite storage cannot be snapshotted per test (`isolatedStorage: true`
        // fails on the `-shm` sidecar), so tests share storage. Each test uses a fresh
        // random board id, so room state never collides across tests.
        isolatedStorage: false,
      },
    },
  },
});
