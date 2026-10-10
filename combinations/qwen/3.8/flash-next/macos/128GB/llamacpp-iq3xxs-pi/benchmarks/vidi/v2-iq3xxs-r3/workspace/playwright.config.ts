import { defineConfig } from '@playwright/test';

import { suite } from './playwright.browsers';

/**
 * E2E runs against `wrangler dev` serving the static client build, so the same
 * serving path is used from day one. All ports must sit inside the range
 * allocated to this agent ($AGENT_PORT_FIRST..$AGENT_PORT_LAST).
 *
 * This is the suite that runs on every change: everything except the @nightly
 * tests, which take minutes and live in `playwright.nightly.config.ts`.
 */
export default defineConfig({
  ...suite({ port: Number(process.env.E2E_PORT ?? 28400), inspectorPort: Number(process.env.E2E_INSPECTOR_PORT ?? 28401) }),
  testDir: './tests/e2e',
  fullyParallel: true,
  grepInvert: /@nightly/,
  reporter: [['list'], ['html', { open: 'never' }]],
});
