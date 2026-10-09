import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Two projects per the story 1 test strategy:
//  - unit: pure camera maths, node environment, tests/unit/**
//  - component: React components in jsdom, tests/component/**
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "component",
          environment: "jsdom",
          include: ["tests/component/**/*.test.tsx"],
          setupFiles: ["tests/component/setup.ts"],
        },
      },
    ],
  },
});
