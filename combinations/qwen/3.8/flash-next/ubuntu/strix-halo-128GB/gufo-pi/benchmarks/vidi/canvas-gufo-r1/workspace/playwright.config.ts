import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import type { Project } from '@playwright/test';

// E2E tests run against `wrangler dev` serving the test-mode static build
// (dist/client) so the same serving path used in production is exercised.
const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Only list browsers that are actually installed in this environment.
// Chromium is always available; Firefox / WebKit are added when present so
// `npm run test:e2e` does not fail on a machine without them.
function browserInstalled(prefix: string): boolean {
  const browsersDir =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    return (
      fs.existsSync(browsersDir) &&
      fs.readdirSync(browsersDir).some((d) => d.startsWith(prefix))
    );
  } catch {
    return false;
  }
}

function buildProjects(): Project[] {
  const viewport = { width: 1280, height: 800 };
  const projects: Project[] = [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
  ];
  // Chromium is the guaranteed baseline. Firefox / WebKit binaries may be
  // present but fail to launch when the OS-level shared libraries are missing
  // (no apt access in this environment). Opt in with E2E_ALL_BROWSERS=1 on a
  // machine where `playwright install --with-deps` has completed.
  if (process.env.E2E_ALL_BROWSERS === '1') {
    if (browserInstalled('firefox')) {
      projects.push({ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } });
    }
    if (browserInstalled('webkit')) {
      projects.push({ name: 'webkit', use: { ...devices['Desktop Safari'], viewport } });
    }
  }
  return projects;
}

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['nightly.spec.ts', 'persistence.spec.ts', 'broken-board.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
  },
  projects: buildProjects(),
  webServer: {
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
