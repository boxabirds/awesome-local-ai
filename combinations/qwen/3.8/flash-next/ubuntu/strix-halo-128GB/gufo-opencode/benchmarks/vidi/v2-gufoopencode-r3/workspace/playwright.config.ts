import { chromium, defineConfig, devices, firefox, webkit } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.E2E_PORT ?? 22704);
const INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? PORT + 1);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function browserAvailable(brand: typeof chromium): boolean {
  try {
    const bin = brand.executablePath();
    if (!fs.existsSync(bin)) return false;
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const projects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }
  }
];
if (browserAvailable(firefox)) {
  projects.push({
    name: 'firefox',
    use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } }
  });
} else {
  console.warn('[playwright.config] firefox binary not available in this environment; skipping firefox project');
}
if (browserAvailable(webkit)) {
  projects.push({
    name: 'webkit',
    use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } }
  });
} else {
  console.warn('[playwright.config] webkit binary not available in this environment; skipping webkit project');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL
  },
  projects,
  webServer: {
    command: `CI=1 npx wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    stdout: 'pipe',
    timeout: 180_000
  }
});
