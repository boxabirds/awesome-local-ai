import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Four projects:
 *
 *  - `unit`: pure functions (shared model, protocol) on Node.
 *  - `component`: React components on jsdom.
 *  - `integration`: the Worker's `fetch` handler in workerd, with the real
 *    wrangler.jsonc bindings — HTTP behaviour (routing, upgrade checks, the SPA
 *    fallback). WebSocket conversations are not possible through the pool's
 *    loopback, so they live in `live`.
 *  - `live`: the room over real WebSockets, against a real `wrangler dev`
 *    instance (see tests/integration/helpers/live-server.ts).
 */
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
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      {
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: [
            'tests/integration/worker.test.ts',
            'tests/integration/board-store.test.ts',
            'tests/integration/room-hibernation.test.ts',
          ],
          pool: 'workers',
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          environment: 'node',
          include: [
            'tests/integration/board-room.test.ts',
            'tests/integration/board-room-persistence.test.ts',
          ],
          globalSetup: ['./tests/integration/global-setup.ts'],
          // One server for the whole project; tests are separated by board id.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
