import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const wsPort = process.env.WS_PORT || '8787';
const wsTarget = `ws://localhost:${wsPort}`;
const wsProxy = { '/ws': { target: wsTarget, ws: true } };

// Share support: bind 0.0.0.0 and allow non-localhost Host headers so the
// game is reachable from the LAN (or through a tunnel) and not just on one box.
const host = process.env.HOST || true;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host,
    port: Number(process.env.APP_PORT) || 5173,
    allowedHosts: true,
    proxy: wsProxy,
  },
  preview: {
    host,
    port: Number(process.env.APP_PORT) || 4173,
    allowedHosts: true,
    proxy: wsProxy,
  },
});
