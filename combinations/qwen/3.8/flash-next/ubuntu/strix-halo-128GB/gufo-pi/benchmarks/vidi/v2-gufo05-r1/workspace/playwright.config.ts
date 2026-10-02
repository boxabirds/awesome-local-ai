import { execFileSync } from 'node:child_process';

import { defineConfig, devices, type Project } from '@playwright/test';

// The e2e suite runs against `wrangler dev` serving the built client from
// dist/client, so the same serving path used in production is exercised.
const PORT = 20194;
const INSPECTOR_PORT = 20195;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Shared libraries an engine needs on Linux. Playwright installs the browser
 * binaries but not the system packages; rather than failing the suite on a host
 * that cannot run an engine, those projects are skipped with a message.
 * Set `E2E_BROWSERS=chromium,firefox,webkit` to choose projects explicitly.
 */
const REQUIRED_LIBRARIES: Record<string, string[]> = {
  chromium: [],
  firefox: ['libgtk-3.so.0'],
  webkit: [
    'libgtk-3.so.0',
    'libepoxy.so.0',
    'libjpeg.so.8',
    'libwebp.so.7',
    'libharfbuzz-icu.so.0',
    'libGLESv2.so.2',
  ],
};

/** Sonames known to the dynamic linker, or null when the host cannot say. */
function knownLibraries(): Set<string> | null {
  for (const binary of ['ldconfig', '/sbin/ldconfig', '/usr/sbin/ldconfig']) {
    try {
      const output = execFileSync(binary, ['-p'], { encoding: 'utf8' });
      const names = new Set<string>();
      for (const line of output.split('\n')) {
        const name = line.trim().split(/\s+/)[0];
        if (name?.endsWith('.so') || name?.includes('.so.')) names.add(name);
      }
      return names;
    } catch {
      // Try the next path.
    }
  }
  return null;
}

const libraries = knownLibraries();

function canRun(name: string): boolean {
  const required = REQUIRED_LIBRARIES[name] ?? [];
  if (required.length === 0 || libraries === null) return true;
  const missing = required.filter((library) => !libraries.has(library));
  if (missing.length === 0) return true;
  // Only the main process reports it; every worker loads this config too.
  if (!process.env.TEST_WORKER_INDEX) {
    console.log(`[e2e] skipping "${name}": the host is missing ${missing.join(', ')}`);
  }
  return false;
}

const ALL_PROJECTS: Project[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
];

const requested = process.env.E2E_BROWSERS?.split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const projects = (requested?.length
  ? ALL_PROJECTS.filter((project) => requested.includes(project.name ?? ''))
  : ALL_PROJECTS
).filter((project) => canRun(project.name ?? ''));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  projects,
  webServer: {
    command: `npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
