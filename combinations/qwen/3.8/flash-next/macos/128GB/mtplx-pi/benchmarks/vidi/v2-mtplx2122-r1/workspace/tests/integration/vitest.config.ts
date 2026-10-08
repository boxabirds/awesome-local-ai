/// <reference types="@cloudflare/vitest-pool-workers" />
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { fileURLToPath } from 'node:url'

/**
 * Integration tests for the Worker entry and the BoardRoom Durable Object.
 *
 * These run inside the real Workers runtime (workerd, through Miniflare) with
 * the real `wrangler.jsonc` bindings, so the `BOARD_ROOM` Durable Object
 * namespace and the `ASSETS` binding that serves `dist/client` are the ones
 * the deployed Worker would get.  `SELF.fetch` hits the real `fetch` handler.
 *
 * Run with `npm run test:integration`.  Kept out of the default vitest
 * workspace so `test:unit`/`test:component` stay fast and dependency-free.
 */

const poolModule = fileURLToPath(
  new URL('../../node_modules/@cloudflare/vitest-pool-workers/dist/pool/index.mjs', import.meta.url),
)
const wranglerConfig = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url))

export default defineWorkersConfig({
  test: {
    // Vitest 2.1 cannot resolve the pool package by name, so point at the file.
    // The declared type only allows the package specifier, hence the cast.
    pool: poolModule as '@cloudflare/vitest-pool-workers',
    include: ['tests/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: wranglerConfig },
      },
    },
  },
})
