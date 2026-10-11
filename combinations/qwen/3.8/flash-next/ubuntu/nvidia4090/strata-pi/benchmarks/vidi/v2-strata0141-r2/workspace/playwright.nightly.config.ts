import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The nightly Playwright project (task 3.9): the two long live-collaboration
 * checks — an idle connection (TC-29) and a full-capacity soak (TC-30) — that
 * are too slow to run on every commit.
 *
 * `npm run test:e2e` does not reach them: the default config's testDir is
 * `tests/e2e`, and these live in `tests/nightly`. Run them with
 * `npm run test:e2e:nightly`.
 */
export default defineConfig({
  ...base,
  testDir: 'tests/nightly',
  // Both tests hold several browser contexts open at once; running them side by
  // side on one machine only makes the timings worse.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // A soak must not sit silently waiting for a note that is not there: an action
  // that cannot complete fails in ten seconds and says which one it was.
  use: { ...base.use, actionTimeout: 10_000 },
  timeout: 30_000,
  projects: (base.projects ?? []).filter(
    (project) => project.name === 'chromium' || project.name === 'firefox',
  ),
});
