// Base Vitest config shared by the unit and component projects.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": new URL("./src/shared", import.meta.url).pathname,
      "@client": new URL("./src/client", import.meta.url).pathname,
      "@tests": new URL("./tests", import.meta.url).pathname,
    },
  },
});
