import { defineConfig } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import react from '@vitejs/plugin-react';

// Three Vitest projects (design "Test scopes and boundaries"):
//  - unit: camera maths, board ids and protocol decoding, node environment
//  - component: BoardViewport / ZoomControls / NavigationHint / badge in jsdom
//  - integration: the Worker and the BoardRoom object inside workerd
// E2E lives in Playwright (playwright.config.ts), not here.
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
          globals: true,
          setupFiles: ['tests/component/setup.ts'],
          include: ['tests/component/**/*.test.tsx'],
        },
      },
      defineWorkersProject({
        // No `extends: true` and no plugins: the workers pool brings its own
        // module conditions, and none of the client's plugins are wanted here.
        // The workers pool provides `cloudflare:test` (SELF, env,
        // runInDurableObject), the workerd module conditions and the
        // `@cloudflare/vitest-pool-workers` pool itself; `wrangler.jsonc`
        // contributes the Worker entry, the BoardRoom binding and the assets.
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          pool: '@cloudflare/vitest-pool-workers',
          poolOptions: {
            workers: {
              wrangler: { configPath: './wrangler.jsonc' },
              // One Worker instance for the whole project: the tests share the
              // runtime, and each of them addresses its own room by name.
              singleWorker: true,
              // BoardRoom holds live WebSocket pairs, and the per-test storage
              // snapshot cannot be restored while a socket is still open (the
              // documented isolated-storage limitation). Sharing one instance is
              // what these tests want anyway: state that leaked would show up as
              // a wrong snapshot, so every test uses a fresh board id.
              isolatedStorage: false,
            },
          },
        },
      }),
    ],
  },
});
