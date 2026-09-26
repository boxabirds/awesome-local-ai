import base from './playwright.config';
import { defineConfig } from '@playwright/test';

// Nightly e2e: the long soak tests (TC-29, TC-30). Same server and projects
// as the main config; only the nightly specs are picked up.
export default defineConfig({
  ...base,
  // One worker: the soak tests are heavy (5 contexts each); running all
  // three browsers in parallel overloads the machine and makes the
  // 1s convergence budget flaky. Serial is fine for a nightly (~7 min).
  workers: 1,
  testIgnore: undefined,
  testMatch: ['**/nightly/**/*.spec.ts'],
});
