import { defineConfig } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

// Three Vitest projects:
//  - `unit`: pure logic (camera maths, board ids, protocol frames) in node.
//  - `component`: React components with Testing Library in jsdom.
//  - `integration`: the worker and BoardRoom under the workerd runtime,
//    driven by raw WebSockets (see tests/integration/ws-client.ts). It runs
//    through the Cloudflare workers pool and needs a built client bundle
//    (the ASSETS binding) — `npm run build` first (the test:integration
//    script does that for you).
// E2E tests (Playwright) are configured separately in playwright.config.ts.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.{test,spec}.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.{test,spec}.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      defineWorkersProject({
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.{test,spec}.ts'],
          pool: '@cloudflare/vitest-pool-workers',
          poolOptions: {
            workers: {
              // Load the worker (main, DO bindings, compatibility date,
              // assets) straight from wrangler.jsonc.
              wrangler: { configPath: 'wrangler.jsonc' },
              // Every test uses a FRESH random board id (a fresh DO
              // instance), so per-test isolated storage buys us nothing —
              // and its teardown assertion is unsound with this workerd
              // build (leftover -shm sidecar file fails the pop).
              isolatedStorage: false,
            },
          },
        },
      }),
    ],
  },
});
