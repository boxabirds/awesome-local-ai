import { execSync } from 'node:child_process';
import { defineConfig, devices, type Project } from '@playwright/test';

const PORT = 8787;
const STATE_DIR = '.e2e-state';
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Firefox and WebKit need GTK on the host. Where those libraries are missing
 * (a container without root, for instance) the projects are dropped with a
 * notice instead of failing every run on `browserType.launch`, and TC-27 /
 * TC-29 — the two the design asks for on every engine — still run on Chromium.
 */
function systemLibraries(): string {
  try {
    return execSync('ldconfig -p', { encoding: 'utf8' });
  } catch {
    return '';
  }
}

const ldCache = systemLibraries();
const has = (library: string): boolean => ldCache.includes(library);
const FIREFOX_LIBS = ['libgtk-3.so.0'];
const WEBKIT_LIBS = ['libgtk-4.so.1', 'libgraphene-1.0.so.0'];

const projects: Project[] = [
  {
    name: 'chromium',
    // The story-5 flows are about links, clipboard and HTTP status codes.
    use: { ...devices['Desktop Chrome'] },
  },
];

for (const [name, use, libs] of [
  ['firefox', devices['Desktop Firefox'], FIREFOX_LIBS],
  ['webkit', devices['Desktop Safari'], WEBKIT_LIBS],
] as [string, typeof devices['Desktop Firefox'], string[]][]) {
  if (libs.every(has)) {
    // The design asks for the dead-link and clipboard-refusal pages on the other
    // engines too: those are the two places where browsers disagree.
    projects.push({ name, grep: /TC-27|TC-29/, use });
  } else {
    console.log(
      `[playwright] skipping "${name}": host is missing ${libs.filter((l) => !has(l)).join(', ')} ` +
        `(install with: npx playwright install --with-deps ${name})`,
    );
  }
}

// End-to-end runs against the real thing: built client assets served by
// `wrangler dev`, real Durable Object storage, real WebSocket rooms.
// TEST_HOOKS:1 enables the legacy-board fixture route (see src/worker/test-hooks.ts).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects,
  webServer: {
    // A fresh local state directory every run: the create rate limiter persists
    // to disk, and TC-30 needs to know exactly how many creates it has left.
    command: `rm -rf ${STATE_DIR} && npm run build && npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port ${PORT} --var TEST_HOOKS:1 --persist-to ${STATE_DIR}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
