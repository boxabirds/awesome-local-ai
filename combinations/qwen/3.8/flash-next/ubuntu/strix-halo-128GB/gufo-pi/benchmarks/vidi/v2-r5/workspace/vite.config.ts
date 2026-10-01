import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is built to `dist/client` so that `wrangler dev` (see wrangler.jsonc)
// serves it as static assets.
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
