import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is built to `dist/client` and served as static assets by the
// Cloudflare Worker (`wrangler dev`), whose config is wrangler.jsonc.
export default defineConfig({
  plugins: [react()],
  // Absolute base: the SPA is served under /b/<boardId> routes, so relative
  // asset URLs would resolve against the wrong path (/b/assets/... → 404 →
  // SPA fallback → text/html instead of JS).
  base: '/',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
