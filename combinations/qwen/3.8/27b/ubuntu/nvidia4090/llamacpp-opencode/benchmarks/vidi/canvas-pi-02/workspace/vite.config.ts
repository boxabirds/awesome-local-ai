import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client build is emitted to dist/client so that `wrangler dev`
// (wrangler.jsonc: assets.directory = dist/client) serves it directly.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
