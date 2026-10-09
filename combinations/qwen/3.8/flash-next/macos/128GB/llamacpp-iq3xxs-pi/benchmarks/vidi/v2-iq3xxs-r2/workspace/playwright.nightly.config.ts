import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The nightly e2e suite: the two `sync.client` checks that are honest but too slow to run
 * on every commit — that an idle board stays connected (TC-29), and that a full room of
 * editors converges, with a latency report (TC-30).
 *
 * Same server, same browsers, same viewport as `playwright.config.ts`; only the file
 * selection and the time allowances differ. Run it with `npm run test:e2e:nightly`.
 */
export default defineConfig({
  ...base,
  testMatch: /.*\.nightly\.spec\.ts/,
  testIgnore: undefined,
  // A nightly failure is a real report: retrying hides whether a connection dropped.
  retries: 0,
  // Five browser contexts each, and a shared machine: one test at a time.
  workers: 1,
  timeout: 1_800_000,
});
