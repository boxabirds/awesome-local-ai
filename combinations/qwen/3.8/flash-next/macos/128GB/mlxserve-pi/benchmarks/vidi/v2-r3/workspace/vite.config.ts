import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is built to dist/client and served as static assets by
// `wrangler dev` (see wrangler.jsonc). `vite` (dev server) is used for
// day-to-day development; e2e tests run against `wrangler dev`.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    target: 'es2022',
  },
  server: {
    port: 5173,
  },
});
