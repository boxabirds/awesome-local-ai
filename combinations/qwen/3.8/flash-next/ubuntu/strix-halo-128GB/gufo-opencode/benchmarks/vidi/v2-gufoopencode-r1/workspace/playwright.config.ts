import { execSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.VIDI6_E2E_PORT ?? 27616);
const INSPECTOR_PORT = Number(process.env.VIDI6_INSPECTOR_PORT ?? 27617);

// Firefox and WebKit binaries need the system GTK libraries; on machines
// without them (no root) they cannot launch, so only Chromium runs there.
function hasGtk(): boolean {
  try {
    return execSync('ldconfig -p', { encoding: 'utf8' }).includes('libgtk-3.so');
  } catch {
    return false;
  }
}

const hasDesktopGecko = hasGtk();
if (!hasDesktopGecko) {
  console.warn('[playwright] libgtk-3 not present: skipping firefox/webkit projects, running chromium only.');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }
    },
    ...(hasDesktopGecko
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } }
          },
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } }
          }
        ]
      : [])
  ],
  webServer: {
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { WRANGLER_SEND_METRICS: 'false' }
  }
});
