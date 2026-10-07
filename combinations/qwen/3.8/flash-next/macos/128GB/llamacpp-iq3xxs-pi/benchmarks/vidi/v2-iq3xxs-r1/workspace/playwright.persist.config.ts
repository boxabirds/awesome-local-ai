import { defineConfig } from '@playwright/test';

/**
 * Story 4 persistence e2e (design TC-19, TC-20, TC-21, TC-24).
 *
 * Kept in its own config because these tests manage the `wrangler dev` process
 * themselves — they must be able to kill it and start another one over the same
 * on-disk state to prove survival across a real process restart. That is
 * incompatible with the base project's single shared `wrangler dev` (25232), so
 * this project runs wrangler on 25240/25241 and runs serially (one process at a
 * time). Run it with `npm run test:e2e:persist`.
 */
export default defineConfig({
  testDir: './tests/e2e-persist',
  timeout: 360_000, // the 2000-note board (TC-21) + two process restarts
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1, // one wrangler process group shared across the file
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:25240',
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
