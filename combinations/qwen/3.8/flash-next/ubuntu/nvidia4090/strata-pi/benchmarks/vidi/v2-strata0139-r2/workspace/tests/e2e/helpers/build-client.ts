import { execSync } from "node:child_process";

/**
 * Story 4 persistence project global setup: build the client once, in test mode.
 *
 * These tests start their own `wrangler dev`, so there is no shared webServer to
 * build the app; `wrangler.jsonc` serves `dist/client`, and test mode is what
 * gives the tests `window.__vidi6`.
 */
export default function buildClient(): void {
  execSync("npm run build:test", { stdio: "inherit" });
}
