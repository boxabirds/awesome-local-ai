import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Ports come from the environment so several agents can share a machine. */
const DEV_PORT = Number(process.env.VIDI6_DEV_PORT ?? 20370);
const PREVIEW_PORT = Number(process.env.VIDI6_PREVIEW_PORT ?? 20371);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: PREVIEW_PORT,
    strictPort: true,
  },
});
