import { defineConfig, devices } from "@playwright/test";
import { PERSIST_INSPECTOR_PORT, PERSIST_PORT } from "./tests/e2e/helpers/wrangler-process";

/**
 * Story 4's persistence e2e project (`npm run test:e2e:persistence`).
 *
 * Deliberately **no** `webServer`: these tests are about the life of the server
 * process, so each one starts and stops its own `wrangler dev --persist-to <tmp
 * dir>` (see `tests/e2e/helpers/wrangler-process.ts`). The client build is made
 * once here, in test mode, because the tests talk to a server they start
 * themselves and Playwright's shared webServer would not be used.
 *
 * Serial (`workers: 1`): the tests share the single port they are allowed to
 * use, and a restart inside a test must not overlap another test's server.
 * Chromium only: what these tests vary is *process* lifetime and storage, not
 * browser behaviour — see NOTES.md.
 */

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/persistence.spec.ts", "**/broken-board.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/helpers/build-client.ts",
  use: {
    baseURL: `http://127.0.0.1:${PERSIST_PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
});

export { PERSIST_PORT, PERSIST_INSPECTOR_PORT };
