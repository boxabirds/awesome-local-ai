import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Vitest 3.2 resolves a custom pool through vite-node, which does not resolve the
// bare package specifier here, so the pool module is addressed by path. The
// package's own config helper keeps the rest of the setup (conditions, worker
// entry, `cloudflare:test`) exactly as documented.
const WORKERS_POOL = fileURLToPath(
  new URL(
    './node_modules/@cloudflare/vitest-pool-workers/dist/pool/index.mjs',
    import.meta.url,
  ),
);
void createRequire;

// Three projects: pure-unit tests run in node, component tests in jsdom, and
// integration tests run *inside workerd* (the real Workers runtime) through
// @cloudflare/vitest-pool-workers, so the Worker and the BoardRoom Durable Object
// are exercised for real (no mocks).
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
          include: ['tests/component/**/*.test.{ts,tsx}'],
          globals: false,
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      // `defineWorkersProject` picks the Workers pool and loads the Worker entry
      // from `main`, so `SELF`, the ASSETS binding and the BOARD_ROOM namespace
      // in these tests are the real ones.
      defineWorkersProject({
        test: {
          name: 'integration',
          pool: WORKERS_POOL as '@cloudflare/vitest-pool-workers',
          include: ['tests/integration/**/*.test.ts'],
          poolOptions: {
            workers: {
              main: './src/worker/index.ts',
              wrangler: { configPath: './wrangler.jsonc' },
              // A room keeps its document in memory, and per-test isolated storage
              // cannot snapshot an in-memory Durable Object (it asserts on the
              // SQLite sidecar files), so the whole suite shares one runtime.
              // Tests never interfere because every case uses a fresh board id.
              isolatedStorage: false,
            },
          },
        },
      }),
    ],
  },
});
