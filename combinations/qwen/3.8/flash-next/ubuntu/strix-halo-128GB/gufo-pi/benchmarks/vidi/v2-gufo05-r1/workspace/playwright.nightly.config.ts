/**
 * The nightly run: the two long tests, on one worker, with room to breathe.
 *
 * `npm run test:e2e:nightly`. Durations come from `src/shared/config.ts` and are
 * scaled only by `NIGHTLY_SHORT=1`, which is for checking the tests themselves;
 * the nightly job runs them at full length.
 */
import { defineConfig } from '@playwright/test';

import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: /nightly\.spec\.ts/,
  // The main config ignores this file; this one has to un-ignore it, since a file
  // has to match `testMatch` and not match `testIgnore` to run at all.
  testIgnore: [],
  workers: 1,
  fullyParallel: false,
  outputDir: 'test-results-nightly',
});
