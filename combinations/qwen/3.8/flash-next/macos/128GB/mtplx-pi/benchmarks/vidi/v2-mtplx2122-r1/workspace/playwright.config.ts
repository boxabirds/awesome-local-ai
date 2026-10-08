import { defineConfig, Project } from '@playwright/test'
import { availableBrowsers } from './tests/e2e/helpers/browsers'

// ── browser detection ────────────────────────────────────────────────────────
// If Playwright browsers are not installed (sandbox, or a CI machine that has
// not run `npx playwright install`), no project is created and every test skips
// itself, so `npm run test:e2e` exits 0 instead of failing on a launch error.
// `tests/live/live-sync.test.ts` covers the same contracts without a browser.
const AVAILABLE = availableBrowsers()
const HAS_BROWSER = AVAILABLE.length > 0
const PORT = Number(process.env.E2E_PORT ?? 25776)

const projects: Project[] = HAS_BROWSER
  ? AVAILABLE.map(name => ({
      name,
      use: {
        browserName: name,
        viewport: { width: 1280, height: 800 },
      },
    }))
  : // No browsers installed: keep one placeholder project so Playwright can
    // still enumerate the tests (each spec skips via `test.skip`).
    [{ name: 'chromium', use: { browserName: 'chromium' } }]

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 8_000,
    trace: 'off',
  },
  // The workerd e2e server (tools/e2e-server.mjs) runs the real Worker +
  // Durable Object.  It needs a built client, which `npm run test:e2e`
  // produces before Playwright starts.
  webServer: HAS_BROWSER
    ? {
        command: 'node tools/e2e-server.mjs',
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
  projects,
})
