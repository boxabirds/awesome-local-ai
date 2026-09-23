import { defineConfig, devices } from "@playwright/test";

// The client is served from a test-mode build (dist/client) that exposes the
// window.__vidi6 test hook. We use `vite preview` here because it serves the same
// dist/client static assets as `wrangler dev` (see NOTES for the sandbox reason).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "npm run build:test && npx --no-install vite preview --port 8787 --host 127.0.0.1 --strictPort",
    cwd: ".",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
