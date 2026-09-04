import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEFAULT_WORKER_DEV_PORT = 8787;
// scripts/run.sh picks a free port when 8787 is taken, and passes it through here.
const WORKER_DEV_PORT = Number(process.env.VITE_WORKER_PORT) || DEFAULT_WORKER_DEV_PORT;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Vite serves the UI; `wrangler dev` serves the API and WebSockets.
      "/api": {
        target: `http://127.0.0.1:${WORKER_DEV_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
