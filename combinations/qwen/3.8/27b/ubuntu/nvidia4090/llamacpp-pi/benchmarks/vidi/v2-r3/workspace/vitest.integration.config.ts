import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real `wrangler dev` server (real workerd
 * Worker + real Durable Objects + real assets), on ports 29042/29043
 * (inside the required 29040-29055 range; 29040/29041 are reserved for the
 * e2e webServer). The server is started by the global setup below and its
 * base URL is injected as INTEGRATION_BASE.
 *
 * NOTE: the design called for the @cloudflare/vitest-pool-workers
 * self-fetch pattern. In the pool environment of this build, WebSocket
 * client sockets never transition out of CONNECTING (no message delivery,
 * verified with a bare WebSocketPair probe), so the tests instead exercise
 * the identical real worker + DO through a local HTTP/WS server. See NOTES.md.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // serial file execution: the suites are heavy (500/2000-note boards,
    // compaction) and parallel workers make sync waits flaky
    fileParallelism: false,
  },
});
