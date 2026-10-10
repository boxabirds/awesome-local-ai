import { defineConfig } from '@playwright/test';

import { suite } from './playwright.browsers';

/**
 * The nightly suite: the tests that hold a board open for minutes (story 3's
 * TC-29 and TC-30). They are tagged `@nightly`, which is exactly what the
 * ordinary config excludes. One worker, because they are about what happens
 * over minutes on a real machine, and four browsers doing that at once would
 * only measure contention.
 *
 * Separate ports from the ordinary suite, so `npm run test:e2e` and
 * `npm run test:e2e:nightly` cannot collide with each other's `wrangler dev`.
 */
export default defineConfig({
  ...suite({
    port: Number(process.env.E2E_NIGHTLY_PORT ?? 28402),
    inspectorPort: Number(process.env.E2E_NIGHTLY_INSPECTOR_PORT ?? 28403),
  }),
  testDir: './tests/e2e',
  grep: /@nightly/,
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  reporter: [['list'], ['html', { open: 'never' }]],
});
