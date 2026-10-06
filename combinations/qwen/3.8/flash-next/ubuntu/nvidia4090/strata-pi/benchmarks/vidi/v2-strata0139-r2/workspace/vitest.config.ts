import react from "@vitejs/plugin-react";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "component",
          environment: "jsdom",
          include: ["tests/component/**/*.test.tsx"],
          setupFiles: ["tests/component/setup.ts"],
        },
      },
      {
        // Integration tests run *inside* workerd: the real Worker fetch
        // handler, the real BoardRoom Durable Object and real WebSockets.
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          // The pool serves `dist/client` as assets (that is what wrangler.jsonc
          // says), so the build has to exist before a test asks for it.
          globalSetup: ["tests/integration/build-assets.ts"],
          // Real sockets, real Durable Objects: the convergence waits are longer
          // than Vitest's default 5s.
          testTimeout: 40_000,
          hookTimeout: 40_000,
        },
        plugins: [
          cloudflareTest({
            main: "src/worker/index.ts",
            wrangler: { configPath: "./wrangler.jsonc" },
          }),
        ],
      },
    ],
  },
});
