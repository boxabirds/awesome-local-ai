import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client build. Output is served as static assets by the Cloudflare Worker
// configured in wrangler.jsonc (assets.directory = dist/client).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
  },
});
