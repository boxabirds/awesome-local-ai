import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ports come from the sandbox allowed range (AGENT_PORT_FIRST 20944 .. AGENT_PORT_LAST 20959).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 20945,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 20946,
    strictPort: true,
  },
});
