import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The nightly e2e project (story 3 task 9): idle-connection stability and the
 * capacity soak. They are real tests of real behaviour, but they run for minutes,
 * which is why `npm run test:e2e` excludes anything tagged `@nightly` and this
 * config runs only those.
 */
export default defineConfig({
  ...base,
  grep: /@nightly/,
  grepInvert: undefined,
  timeout: 300_000,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
});
