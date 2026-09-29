/// <reference types="vitest/config" />
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Every build gets an id. It is compiled into the page and written next to it for the server, which
// sends it with every state; a page whose own id differs from the server's reloads itself.
const BUILD_ID = `${Date.now().toString(36)}`;
const BUILD_ID_FILE = "build-id.txt";

function writeBuildId(): Plugin {
  return {
    name: "write-build-id",
    writeBundle(options) {
      writeFileSync(resolve(options.dir ?? "dist", BUILD_ID_FILE), BUILD_ID);
    },
  };
}

export default defineConfig({
  plugins: [react(), writeBuildId()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { proxy: { "/api": "http://127.0.0.1:7760" } },
  test: { include: ["server/**/*.test.ts"] },
});
