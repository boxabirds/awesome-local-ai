import { defineConfig } from "@playwright/test";

import { suite } from "./playwright.browsers";

/**
 * persist.room (story 4): the browser tests in which the server is *killed*.
 *
 * These cannot share a `webServer` with anything else. Each one starts a
 * `wrangler dev` of its own (see `tests/e2e/helpers/wrangler-process.ts`), with
 * its own local state directory, and stops it on purpose — so two of them
 * running at once would be two servers fighting over the port, and a test
 * accidentally talking to the leftovers of another would prove nothing at all.
 * That costs parallelism: one worker, one test at a time.
 *
 * Ports: 28404 (dev), 28405 (`wrangler dev --inspector-port`).
 */
export default defineConfig({
  ...suite({
    port: Number(process.env.E2E_PERSIST_PORT ?? 28404),
    inspectorPort: Number(process.env.E2E_PERSIST_INSPECTOR_PORT ?? 28405),
  }),
  testDir: "./tests/e2e",
  // The tests own their server; `webServer` would start one they would then kill.
  webServer: undefined,
  grep: /@persistence/,
  fullyParallel: false,
  workers: 1,
  // Three wrangler processes per test, one Chromium each, and a 2,000-note board.
  timeout: 300_000,
  ...(process.env.CI
    ? { reporter: [["github"], ["html", { open: "never" }]] }
    : {}),
});
