import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server port is configurable so it can be pointed at an allowed port
// range (see NOTES.md); it defaults to the range used by this project.
const devPort = Number(process.env.VIDI6_DEV_PORT ?? 20786);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // Listen on all interfaces so the board is reachable through both
    // 127.0.0.1 and localhost; strictPort is off on purpose, so a busy port
    // moves to the next one inside the allowed range instead of failing.
    host: true,
    port: devPort,
  },
  preview: {
    host: true,
    port: devPort,
  },
});
