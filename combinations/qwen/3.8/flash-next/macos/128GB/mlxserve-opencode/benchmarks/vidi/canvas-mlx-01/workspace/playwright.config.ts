import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.VIDI_PORT ?? 8790);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

// Firefox starts its own OS-level process sandbox, which cannot be initialised when
// the test run is itself sandboxed (it dies with `sandbox_init() failed`). Relax the
// browser's own sandbox only; nothing about the page or the assertions changes.
for (const flag of [
  'MOZ_DISABLE_CONTENT_SANDBOX',
  'MOZ_DISABLE_GPU_SANDBOX',
  'MOZ_DISABLE_SOCKET_PROCESS_SANDBOX',
]) {
  process.env[flag] ??= '1';
}

/**
 * End-to-end evidence for story 1 (pan and zoom on an infinite board).
 *
 * The webServer command builds the client in `test` mode (so the `window.__vidi6`
 * hook exists) and serves `dist/client` with `wrangler dev`, i.e. the same
 * static-asset path used in production. `tests/e2e/NOTES.md` records which cases
 * could not be automated and what was measured instead.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  metadata: {
    // Rendered surfaces a human reviewer can look at directly.
    review: {
      board: `${BASE_URL}/__review/board`,
      zoomControls: `${BASE_URL}/__review/zoom-controls`,
      zoomLabel: `${BASE_URL}/__review/zoom-label`,
      camera: `${BASE_URL}/__review/camera`,
      note: 'single-page-application fallback: every path serves the board',
    },
    notes: 'tests/e2e/NOTES.md',
  },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    video: 'off',
  },
  projects: [
    // The laptop viewport from the story; the device presets would otherwise
    // quietly change it to 1280x720, and the camera is viewport-relative.
    {
      name: 'chromium',
      // The Safari `gesturestart/change/end` trio is a WebKit-only event family;
      // it is asserted in the webkit project only.
      testIgnore: /.*\.webkit\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
    {
      name: 'firefox',
      testIgnore: /.*\.webkit\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], viewport: VIEWPORT },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: VIEWPORT },
    },
  ],
  webServer: {
    command: `npm run build:test && npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 300_000,
    stdout: 'pipe',
  },
});
