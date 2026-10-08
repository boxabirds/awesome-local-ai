/**
 * Story 3 e2e helpers shared by the live-collaboration specs.
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
