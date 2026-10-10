import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ROOM_ROUTE_PREFIX } from './src/shared/config';

// Client-only build: static assets are served by `wrangler dev` (see wrangler.jsonc).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 24066,
    strictPort: true,
    /**
     * `npm run dev` runs the Worker on 24064 and this client on 24066, but a
     * board reaches its room through the page's own origin (that is how
     * `wrangler dev` serves it in production). So in development the room route
     * is forwarded to the Worker, with the WebSocket upgrade enabled - otherwise
     * `npm run dev` would show a board that never connects.
     */
    proxy: {
      // The same route the client opens, taken from the shared setting.
      [ROOM_ROUTE_PREFIX.replace(/\/+$/, '')]: {
        target: `http://127.0.0.1:${process.env.VIDI6_DEV_WORKER_PORT ?? 24064}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
