import { execFileSync } from 'node:child_process';

import { devices, defineConfig, type Project } from '@playwright/test';

/** Port range for this agent: wrangler dev serves dist/client here. */
const PORT = Number(process.env.VIDI6_E2E_PORT ?? 28736);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

type BrowserName = 'chromium' | 'firefox' | 'webkit';

/**
 * Some hosts have the Playwright browsers downloaded but not the system
 * libraries they need to start (no root to install them). Skip those browsers
 * instead of failing every test, and say so. Override with
 * `VIDI6_BROWSERS=chromium,firefox,webkit`.
 */
function selectedBrowsers(): BrowserName[] {
  const all: BrowserName[] = ['chromium', 'firefox', 'webkit'];
  const requested = process.env.VIDI6_BROWSERS?.split(',')
    .map((name) => name.trim())
    .filter((name): name is BrowserName => (all as string[]).includes(name));
  if (requested && requested.length > 0) return requested;
  if (process.env.VIDI6_SKIP_BROWSER_PROBE === '1') return all;
  return all.filter((name) => {
    const usable = browserIsUsable(name);
    if (!usable) {
      console.warn(
        `[playwright] skipping ${name}: this host cannot start it (missing system libraries).`,
      );
    }
    return usable;
  });
}

function browserIsUsable(name: BrowserName): boolean {
  const probe = `
    const pw = require('@playwright/test');
    pw.${name}
      .launch({ headless: true })
      .then(async (browser) => { await browser.close(); process.exit(0); })
      .catch(() => process.exit(1));
  `;
  try {
    execFileSync(process.execPath, ['-e', probe], { stdio: 'ignore', timeout: 45_000 });
    return true;
  } catch {
    return false;
  }
}

const DEVICE_NAMES: Record<BrowserName, string> = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  webkit: 'Desktop Safari',
};

const projects: Project[] = selectedBrowsers().map((name) => ({
  name,
  use: { ...devices[DEVICE_NAMES[name]], viewport: VIEWPORT },
}));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
  },
  projects,
  webServer: {
    command: 'npm run e2e:serve',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
