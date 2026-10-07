import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Test projects (design "Testing strategy"):
 *
 * - unit        node, lib0/y-protocols/yjs only — no DOM, no network
 * - component   jsdom + React Testing Library
 * - integration workerd (`@cloudflare/vitest-pool-workers`): the real Worker and
 *               BoardRoom with real WebSocket pairs, `SELF.fetch` and stubbed
 *               Durable Objects. `npm run build` has to have produced
 *               `dist/client` first (the `pretest:*` scripts do that), because
 *               the assets binding serves the client from there, and the test
 *               routes are turned on (see the note on the integration project).
 * - e2e         a guard: Playwright owns those specs (tests/e2e), and it cannot
 *               run inside vitest.
 */

const unitProject = {
  test: {
    // yjs and lib0 go through Vite's module graph rather than being loaded straight
    // from node_modules. That is what lets a test mock `lib0/time` and have *yjs* see
    // the mock rather than its own untouched copy: TC-12 and TC-13 step the capture
    // window past 500 ms without the suite waiting for half a second to pass.
    server: { deps: { inline: ['yjs', 'lib0'] } },
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
};

const componentProject = {
  test: {
    name: 'component',
    environment: 'jsdom',
    include: ['tests/component/**/*.test.tsx'],
    setupFiles: ['tests/component/setup.ts'],
    // jsdom's location, so the App's `/` -> `/b/<id>` redirect logic runs the
    // same way it does in the browser tests.
    environmentOptions: { jsdom: { url: 'http://localhost/b/vN8d2mKx1pQ0tY7rZ4wL3A' } },
  },
};

const integrationProject = {
  // The Workers runtime pool: tests and the Worker run in workerd, with the
  // bindings (BOARD_ROOM, ASSETS) read from wrangler.jsonc.
  plugins: [
    // The Worker, its Durable Object and the asset bucket all come from the
    // production `wrangler.jsonc`. The one thing added here is `TEST_HOOKS`, which is
    // what turns the routes in `src/worker/test-hooks.ts` on: without it
    // `/__test/...` is not a route and the Worker hands it to the assets like any
    // other unknown path. The e2e suite passes the same variable to the `wrangler dev`
    // it starts. It is set here rather than in `wrangler.jsonc` because that file is
    // the production configuration, and a deployment built from this repository must
    // not have those routes to find.
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { TEST_HOOKS: '1' } },
    }),
  ],
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    // One file at a time: every file shares the same Worker and the same Durable
    // Object instances, and the tests time round trips.
    fileParallelism: false,
    // No jsdom: these tests speak the socket protocol, not the DOM.
    environment: 'node',
    testTimeout: 20_000,
  },
};

const e2eGuard = {
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['tests/e2e/**/*.spec.ts'],
    // Playwright runs these. Vitest would only load them to fail on the missing
    // `@playwright/test` globals, so it says so instead.
    passWithNoTests: true,
    includeMetaProperties: [],
  },
};

export default defineConfig({
  test: {
    projects: [unitProject, componentProject, integrationProject, e2eGuard],
  },
});
