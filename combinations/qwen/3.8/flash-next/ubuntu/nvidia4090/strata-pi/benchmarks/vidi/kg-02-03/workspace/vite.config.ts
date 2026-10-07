import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ports come from the sandbox's allowed range (AGENT_PORT_FIRST..LAST).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 28850,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 28851,
    strictPort: true,
  },
});
