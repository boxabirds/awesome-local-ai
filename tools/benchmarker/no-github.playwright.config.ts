import { defineConfig } from "@playwright/test";

// W-1 (story 23, TC-B1): the benchmarker over a lake that a real node, the real collector and the real ingest filled
// from a run made with no git remote. tests/no-github-e2e-test.sh makes all of that and starts the server; this config
// starts none of its own (the normal suite's playwright.config.ts does not look in this folder).
export default defineConfig({
  testDir: "e2e-no-github",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: process.env.W1_BASE },
});
