import { defineConfig } from 'vitest/config'

/**
 * Live-sync tests: real `WebsocketProvider` clients against the real Worker +
 * BoardRoom Durable Object, started per file on an ephemeral port (workerd,
 * through Miniflare).  No browsers needed, so this runs in the sandbox too —
 * it is the fallback for `tests/e2e/live-collaboration.spec.ts`, which skips
 * when no Playwright browser is installed.
 *
 * Run with `npm run test:live` (bundles the Worker first).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    // The tests share one workerd server and one event loop per file; running
    // files in parallel only makes the timings noisy.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
