import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure logic only: nothing here touches a database or the network.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
