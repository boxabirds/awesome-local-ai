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
const BASE_URL = `http://127.0.0.1:${PORT}`;
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

const gtkAvailable = hasGtk();
const allProjects: Project[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
  { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } }
];
const projects = allProjects.filter((project) => {
  if (project.name === 'chromium' || gtkAvailable) return true;
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
    trace: 'retain-on-failure'
  },
  projects,
  webServer: {
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1 --inspector-port ${INSPECTOR_PORT} --show-interactive-dev-session=false`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 180_000
  }
});
