/**
 * Which Playwright browsers actually exist on this machine.
 *
 * Used by both Playwright configs (default and nightly) and by the spec files:
 * when nothing is installed the configs create no real project and every spec
 * skips itself, so `npm run test:e2e` exits 0 in a sandbox instead of failing
 * with "Executable doesn't exist".  The detection is a plain `executablePath()`
 * + `existsSync`, which is what Playwright itself checks before launching.
 */
import { existsSync } from 'node:fs'
import { chromium, firefox, webkit } from '@playwright/test'

export type BrowserName = 'chromium' | 'firefox' | 'webkit'

const CANDIDATES: ReadonlyArray<readonly [BrowserName, { executablePath(): string }]> = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]

export function availableBrowsers(): BrowserName[] {
  const found: BrowserName[] = []
  for (const [name, browserType] of CANDIDATES) {
    try {
      if (existsSync(browserType.executablePath())) found.push(name)
    } catch {
      // No browser registry entry at all → treat as missing.
    }
  }
  return found
}

export function hasBrowser(): boolean {
  return availableBrowsers().length > 0
}
