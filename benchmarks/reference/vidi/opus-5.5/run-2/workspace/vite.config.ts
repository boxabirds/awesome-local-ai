import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** `npm run dev` proxies board rooms to a `wrangler dev` running on its default port. */
const WRANGLER_DEV_ORIGIN = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: WRANGLER_DEV_ORIGIN, ws: true } },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
