// Prepares a usable Chromium for the e2e runs (see NOTES.md). Runs before
// the e2e scripts via npm pre-hooks; harmless no-op when a browser already
// exists. (Kept dependency-free: mirrors CACHED_BROWSERS from
// playwright.launch.ts.)
import { existsSync } from 'node:fs';

const CACHED_BROWSERS = '~/.cache/vidi-agent-ms-playwright';

if (existsSync(CACHED_BROWSERS)) {
  console.log(`using pre-seeded Playwright browsers at ${CACHED_BROWSERS}`);
} else {
  const { default: chromium } = await import('@sparticuz/chromium');
  const path = await chromium.executablePath();
  console.log(`extracted @sparticuz/chromium to ${path}`);
}
