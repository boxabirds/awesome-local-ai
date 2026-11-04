import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// The end-to-end tests run the built app against a server fed from a fixture (no lake, no dbench), so they check what
// the page shows for known data. A second server reads a fixture lake through the real bench-lake (lake.spec.ts): its
// state folder links to bench-lake's fixture lake and adds the operator's decisions (annotations/log.jsonl).
const PORT = 7769;
export const LAKE_PORT = 7770;
const HERE = import.meta.dirname;
/** The tools workspace's build of bench-lake: the release checks build it (cargo test --workspace) before these run. */
const BENCH_LAKE = process.env.BENCH_LAKE ?? resolve(HERE, "../target/debug/bench-lake");
/** The lake server's PATH: this one without any folder that holds dbench, so no machine is contacted. */
const LAKE_PATH = (process.env.PATH ?? "").split(":").filter((d) => d && !existsSync(join(d, "dbench"))).join(":");

export default defineConfig({
  // One fixture server serves every test, and some tests change its fake dbench (queue, stop): run them one at a time.
  workers: 1,
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: [
    {
      command: `bun server/main.ts --port ${PORT} --fixture e2e/fixture.json --dist dist-test`,
      url: `http://127.0.0.1:${PORT}/api/state`,
      reuseExistingServer: false,
    },
    {
      command: [
        "bun server/main.ts", `--port ${LAKE_PORT}`, "--dist dist-test",
        "--repo e2e/fixtures/lake-checkout", "--lake e2e/fixtures/lake-state", `--bench-lake ${BENCH_LAKE}`,
        "--conversations-url http://127.0.0.1:1",
      ].join(" "),
      url: `http://127.0.0.1:${LAKE_PORT}/api/state`,
      env: { PATH: LAKE_PATH },
      reuseExistingServer: false,
    },
  ],
});
