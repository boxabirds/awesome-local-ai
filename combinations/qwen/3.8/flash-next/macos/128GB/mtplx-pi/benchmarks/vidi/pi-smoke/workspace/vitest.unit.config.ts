import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: "unit",
      environment: "node",
      include: ["tests/unit/**/*.test.ts"],
    },
  }),
);
