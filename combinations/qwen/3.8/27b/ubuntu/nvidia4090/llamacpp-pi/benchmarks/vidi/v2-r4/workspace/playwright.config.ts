import { defineConfig } from "@playwright/test";

// E2E runs against `wrangler dev` serving the client build from dist/client,
// so the same serving path as production is used. The client is built with
// `--mode test` which enables the window.__vidi6 test hook (see design
// "Fixtures"); production builds exclude the hook.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:29540",
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "npm run build:e2e && wrangler dev --port 29540 --ip 127.0.0.1 --local",
    url: "http://127.0.0.1:29540",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
