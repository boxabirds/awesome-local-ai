import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is built to `dist/client` and served as static assets by the
// Cloudflare Worker (`wrangler dev`), whose config is wrangler.jsonc.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
