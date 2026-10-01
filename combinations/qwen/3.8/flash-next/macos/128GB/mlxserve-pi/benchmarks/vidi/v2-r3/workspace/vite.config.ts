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
    proxy: {
      // A board's room is served by the Worker, so developing against the dev
      // server means running `npx wrangler dev` alongside it (`npm run dev` is
      // otherwise a board nobody can reach: the socket would be aimed at this
      // port, where only Vite listens). `ws: true` carries the board's
      // WebSocket too, which is the whole of what a second person needs.
      '/api': { target: 'http://localhost:8787', changeOrigin: true, ws: true },
    },
  },
});
