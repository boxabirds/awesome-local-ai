import { build } from "vite";

/**
 * Integration-project global setup: build the client before the Worker is asked
 * to serve it.
 *
 * `wrangler.jsonc` (which `@cloudflare/vitest-pool-workers` reads) serves
 * `./dist/client` as assets, so an integration test that looks at the served app
 * shell — TC-32's `index.html` check — is only meaningful if `dist/client` is the
 * current build and not whatever the last run left there.
 */
export default async function buildAssets(): Promise<void> {
  await build({ configFile: "vite.config.ts", logLevel: "warn" });
}
