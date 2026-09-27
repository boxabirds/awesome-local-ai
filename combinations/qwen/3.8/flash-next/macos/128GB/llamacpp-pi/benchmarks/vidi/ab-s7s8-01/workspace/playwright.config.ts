import { defineConfig, devices } from '@playwright/test';

// Static assets served by `wrangler dev` from dist/client, exactly the serving
// path the app ships through. The webServer serves a `--mode test` build (see
// the test:e2e npm script) so the test-only window.__vidi6 hook is present.
//
// NOTE on `reuseExistingServer`: a server left over from the integration suite
// carries `--var TEST_HOOKS:1` — and so does the command below (fixtures need
// the create-limiter bypass and the storage hooks). That is invisible to the
// interaction specs but it would make production-hooks.spec.ts vacuous, so
// that spec does NOT trust this server — it starts its own workerd (see
// tests/e2e/helpers/local-worker).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8799',
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  webServer: {
    // TEST_HOOKS=1 for the e2e server: fixtures create boards through
    // POST /api/boards with the `x-test-ignore-limit` bypass (so a whole run
    // cannot starve itself on the 10/60s create limiter), and share.spec's
    // legacy-board case needs the /__test/rooms/<id>/… storage hooks.
    // production-hooks.spec.ts does NOT use this server, so the flag cannot
    // make its "off in production" check vacuous.
    command: 'npx wrangler dev --port 8799 --ip 127.0.0.1 --var TEST_HOOKS:1',
    url: 'http://127.0.0.1:8799/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox and WebKit are listed in the story test strategy but were not
    // installed in this environment; Chromium alone is accepted here.
  ],
});