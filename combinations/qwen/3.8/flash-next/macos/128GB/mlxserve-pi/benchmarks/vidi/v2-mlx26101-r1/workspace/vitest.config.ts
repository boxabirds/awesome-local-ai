import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import {
  cloudflarePool,
  cloudflareTest,
} from '@cloudflare/vitest-pool-workers';

const WRANGLER_CONFIG = './wrangler.jsonc';

// Component tests render the real React tree but have no server to talk to, so
// `y-websocket` is replaced by a deterministic stub **in that project only**. The
// transport is tested for real in workerd (integration) and in browsers against
// `wrangler dev` (e2e); `npm run build` and typecheck still see the real module.
const Y_WEBSOCKET_STUB = fileURLToPath(
  new URL('./tests/component/y-websocket-stub.ts', import.meta.url),
);

// Three projects:
//  - unit:        pure logic in node
//  - component:   DOM component tests in jsdom
//  - integration: the real Worker + Durable Object, run inside workerd by
//                 @cloudflare/vitest-pool-workers with the bindings from
//                 wrangler.jsonc (BOARD_ROOM Durable Object, ASSETS static files)
// `npm run test:unit` / `test:component` / `test:integration` select one.
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
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
        resolve: {
          alias: [{ find: /^y-websocket$/, replacement: Y_WEBSOCKET_STUB }],
        },
      },
      {
        // `cloudflareTest` is scoped to this project only: it rewrites resolve
        // conditions and the SSR target for `cloudflare:test` support, which the
        // jsdom project must not inherit.
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: WRANGLER_CONFIG } })],
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          pool: cloudflarePool({ wrangler: { configPath: WRANGLER_CONFIG } }),
          // Real sockets and Durable Objects are involved; the waits inside the
          // helpers are functional and much shorter than this ceiling.
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
