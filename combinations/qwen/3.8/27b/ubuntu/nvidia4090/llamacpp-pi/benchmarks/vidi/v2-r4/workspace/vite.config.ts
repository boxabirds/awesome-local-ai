import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Client build is emitted to dist/client so the Cloudflare Worker can serve
// it as static assets (see wrangler.jsonc).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
  },
  server: {
    port: 29536,
  },
});
