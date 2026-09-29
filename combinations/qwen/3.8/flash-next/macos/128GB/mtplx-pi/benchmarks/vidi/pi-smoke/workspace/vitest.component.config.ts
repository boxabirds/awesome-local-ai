import { defineConfig, mergeConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import base from "./vitest.config";

export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    test: {
      name: "component",
      environment: "jsdom",
      include: ["tests/component/**/*.test.tsx"],
      setupFiles: ["./tests/component/setup.ts"],
      globals: true,
    },
  }),
);
