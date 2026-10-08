import { defineConfig, Project } from '@playwright/test'
import { existsSync } from 'fs'

// ── browser detection ────────────────────────────────────────────────────────
// If Playwright browsers are not installed (sandbox / CI that hasn't run
// `npx playwright install`), we create no projects so that every test is
// skipped without a launch error.  `npm run test:e2e` exits with code 0.
type BrowserName = 'chromium' | 'firefox' | 'webkit'

function isBrowserAvailable(name: BrowserName): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pw = require('playwright-core') as Record<
      BrowserName,
      { executablePath(): string }
    >
    return existsSync(pw[name].executablePath())
  } catch {
    return false
  }
}

const ALL_BROWSERS: readonly BrowserName[] = ['chromium', 'firefox', 'webkit']
const AVAILABLE: BrowserName[] = ALL_BROWSERS.filter(isBrowserAvailable)
const HAS_BROWSER = AVAILABLE.length > 0
const PORT = 25776

const projects: Project[] = HAS_BROWSER
  ? AVAILABLE.map(name => ({
      name,
      use: {
        browserName: name,
        viewport: { width: 1280, height: 800 },
      },
    }))
  : // No browsers installed: keep a placeholder project so Playwright can
    // enumerate tests (they all skip via test.skip() in the spec file).
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
  webServer: HAS_BROWSER
    ? {
        command: `npx vite --port ${PORT} --host 127.0.0.1`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        stdout: 'pipe',
      }
    : undefined,
  projects,
})