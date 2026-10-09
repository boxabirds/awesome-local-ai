import { defineConfig, devices } from '@playwright/test';
import { selectedBrowsers } from './tests/e2e/helpers/browsers';

/**
 * End-to-end tests for the board in Chromium, Firefox and WebKit.
 *
 * The server is a Cloudflare Worker serving the built client (the shape story 3 grows
 * into). The `webServer` command builds the client in Vite's `test` mode first, which is
 * what enables the `window.__vidi6` test hook (`e2e:build` / `e2e:server` in package.json
 * are the same commands on their own).
 *
 * Every browser gets the same 1280x800 board area, matching the viewport fixture the
 * unit and component tests use. See `tests/e2e/helpers/browsers.ts` for why a browser is
 * skipped when it cannot be launched on the machine running the tests.
 */
const PORT = Number(process.env.AGENT_PORT_E2E ?? 27426);
const INSPECTOR_PORT = Number(process.env.AGENT_PORT_E2E_WRANGLER ?? 27427);
const VIEWPORT = { width: 1280, height: 800 };

const DESKTOP = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

const browsers = selectedBrowsers();

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  // The nightly checks (`*.nightly.spec.ts`) run on their own via `test:e2e:nightly`;
  // they are too slow to be part of every commit.
  // The nightly checks and the persistence suite run on their own: the persistence
  // tests own and kill their own server, which no shared webServer can put back.
  testIgnore: [/\.nightly\.spec\.ts$/, /persistence\.spec\.ts$/, /broken-board\.spec\.ts$/],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    viewport: VIEWPORT,
    // An action that cannot happen (a note another person deleted, a control that is
    // covered) is reported as itself after ten seconds instead of eating the whole test
    // budget — which matters most in the soak, where notes disappear all the time.
    actionTimeout: 10_000,
  },
  projects: browsers.map((name) => ({
    name,
    use: { ...DESKTOP[name], viewport: VIEWPORT },
  })),
  webServer: {
    command: `npm run e2e:build && CI=1 WRANGLER_SEND_METRICS=false npx wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --log-level=warn`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
