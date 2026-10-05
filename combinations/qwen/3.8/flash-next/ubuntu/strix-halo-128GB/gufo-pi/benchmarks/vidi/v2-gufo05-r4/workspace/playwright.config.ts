import { execSync } from 'node:child_process';
import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * E2E runs against the real serving path: `wrangler dev` serves the built
 * client from `dist/client`. The client is built with `--mode test` so the
 * test-only `window.__vidi6` camera hook exists (it is tree-shaken out of
 * production builds).
 *
 * Ports come from the range allocated to this machine.
 */
const PORT = 21330;
const INSPECTOR_PORT = 21331;
/** Exported so helpers can build absolute URLs for a board of their own. */
export const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

/**
 * Firefox and WebKit need GTK on this machine. When it is missing (this
 * container has no root and no GTK), those projects are skipped with a warning
 * instead of failing every run - see NOTES.md.
 */
function hasGtk(): boolean {
  try {
    return /libgtk-3/.test(execSync('ldconfig -p', { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

/**
 * The nightly cases (TC-29, TC-30) sit in files of their own and in a project of
 * their own, so `npm run test:e2e:nightly` runs nothing else. They are also tagged
 * `@nightly`, because a plain `playwright test` runs every project in this file:
 * `npm run test:e2e` filters on the tag, which keeps a commit run to about a minute.
 */
const NIGHTLY_FILE = /.*\.nightly\.spec\.ts$/;

/**
 * The persistence cases bring their own `wrangler dev` up and kill it, because that is
 * the story: a process that forgets its memory. They cannot share the web server below
 * (killing it would stop every other spec), so they are a project of their own, on their
 * own port, running one at a time. Playwright has no per-project opt-out of a global
 * `webServer`, so the shared one still comes up for a run that only selects these — it is
 * idle, and it costs a few seconds.
 */
const PERSISTENCE_FILE = /.*\.persist\.spec\.ts$/;

const gtkAvailable = hasGtk();
const chromeUse = { ...devices['Desktop Chrome'], viewport: VIEWPORT };
const allProjects: Project[] = [
  { name: 'chromium', use: chromeUse, testIgnore: [NIGHTLY_FILE, PERSISTENCE_FILE] },
  { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT }, testIgnore: [NIGHTLY_FILE, PERSISTENCE_FILE] },
  { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT }, testIgnore: [NIGHTLY_FILE, PERSISTENCE_FILE] },
  // Story 4: one at a time, because each case restarts the server the others would use.
  { name: 'persistence', use: chromeUse, testMatch: PERSISTENCE_FILE, fullyParallel: false },
  // Always chromium: these check the sync client and the room, not a browser engine,
  // and running a two-minute soak three times over buys nothing.
  { name: 'nightly', use: chromeUse, testMatch: NIGHTLY_FILE, fullyParallel: false }
];
const projects = allProjects.filter((project) => {
  // Chromium and the two single-browser projects run whatever the host has; firefox and
  // webkit are the ones that need GTK.
  if (project.name === 'chromium' || project.name === 'nightly' || project.name === 'persistence' || gtkAvailable) {
    return true;
  }
  if (!process.env.VDI6_E2E_GTK_WARNED) {
    process.env.VDI6_E2E_GTK_WARNED = '1';
    console.warn('[e2e] skipping firefox and webkit: this host has no GTK libraries');
  }
  return false;
});

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    trace: 'retain-on-failure',
    // Without this an action waiting on something it can never reach quietly eats the
    // whole test timeout instead of saying what it was waiting for.
    actionTimeout: 20_000
  },
  projects,
  webServer: {
    // `TEST_HOOKS=1` turns on the `/__test/` board-surgery routes story 4's TC-24 needs
    // to damage a board from a browser. It is a command-line var of *this* server and is
    // not in `wrangler.jsonc`, so a deployed Worker has no such routes — and the
    // persistence project's own server does not pass it either.
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1 --inspector-port ${INSPECTOR_PORT} --var TEST_HOOKS:1 --show-interactive-dev-session=false`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 180_000
  }
});
