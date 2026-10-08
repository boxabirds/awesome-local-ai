import { defineConfig, Project } from '@playwright/test'
import { availableBrowsers } from './tests/e2e/helpers/browsers'

/**
 * Nightly Playwright project (task 3.9): idle-connection stability and the
 * capacity soak.  Kept out of `tests/e2e`, so `npm run test:e2e` stays fast
 * and this file only runs through `npm run test:e2e:nightly`.
 *
 * Same browser detection as the default config: without browsers installed
 * nothing is launched and the specs skip themselves.
 */
const AVAILABLE = availableBrowsers()
const HAS_BROWSER = AVAILABLE.length > 0
const PORT = Number(process.env.E2E_PORT ?? 25790)

const projects: Project[] = HAS_BROWSER
  ? AVAILABLE.map(name => ({
      name,
      use: {
        browserName: name,
        viewport: { width: 1280, height: 800 },
      },
    }))
  : [{ name: 'chromium', use: { browserName: 'chromium' } }]

export default defineConfig({
  testDir: './tests/e2e-nightly',
  // The soak runs for 60 s of continuous editing on top of setup and teardown.
  timeout: 240_000,
  fullyParallel: false,
  // One machine, real browsers, long runs: serialise.
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 8_000,
    trace: 'off',
  },
  webServer: HAS_BROWSER
    ? {
        command: `E2E_PORT=${PORT} node tools/e2e-server.mjs`,
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
  projects,
})
