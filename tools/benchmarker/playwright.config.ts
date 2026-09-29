import { defineConfig } from "@playwright/test";

// The end-to-end tests run the built app against a server fed from a fixture (no git, no dbench),
// so they check what the page shows for known data.
const PORT = 7769;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `node server/main.ts --port ${PORT} --fixture e2e/fixture.json`,
    url: `http://127.0.0.1:${PORT}/api/state`,
    reuseExistingServer: false,
  },
});
