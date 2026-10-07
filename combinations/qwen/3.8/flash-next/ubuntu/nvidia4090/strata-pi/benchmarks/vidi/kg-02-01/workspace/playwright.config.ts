import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against `wrangler dev` serving the static client build, so the same
 * serving path used in production is exercised from day one.
 *
 * Port is inside the sandbox's allowed range (AGENT_PORT_FIRST..LAST).
 */
const PORT = Number(process.env.E2E_PORT ?? 27073);
const VIEWPORT = { width: 1280, height: 800 };

const ALL_PROJECTS = {
  chromium: { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: VIEWPORT } },
  firefox: { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: VIEWPORT } },
  webkit: { name: "webkit", use: { ...devices["Desktop Safari"], viewport: VIEWPORT } },
};

/**
 * WebKit needs system libraries (libavif) that this machine does not have and
 * cannot install (no root), so the project is only added when the browser is
 * installed *and* its system libraries are present. See NOTES.md.
 */
function systemLibPresent(pattern: string): boolean {
  try {
    return execSync("ldconfig -p", { encoding: "utf8" }).includes(pattern);
  } catch {
    return false;
  }
}

/** Browsers actually installed on this machine (see NOTES.md). */
function installedBrowsers(): (keyof typeof ALL_PROJECTS)[] {
  const browsers: (keyof typeof ALL_PROJECTS)[] = ["chromium"];
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache", "ms-playwright");
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (entries.some((entry) => entry.startsWith("firefox-"))) browsers.push("firefox");
  if (
    entries.some((entry) => entry.startsWith("webkit-")) &&
    systemLibPresent("libavif")
  ) {
    browsers.push("webkit");
  }

  const override = process.env.E2E_BROWSERS;
  if (override) {
    const requested = override.split(",").map((name) => name.trim()) as (keyof typeof ALL_PROJECTS)[];
    return requested.filter((name) => ALL_PROJECTS[name]);
  }
  return browsers;
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: VIEWPORT,
    trace: "off",
  },
  projects: installedBrowsers().map((name) => ALL_PROJECTS[name]),
  webServer: {
    command: "npm run serve:e2e",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
