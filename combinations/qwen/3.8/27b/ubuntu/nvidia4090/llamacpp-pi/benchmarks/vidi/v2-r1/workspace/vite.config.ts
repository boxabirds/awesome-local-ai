import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { boardSyncPlugin } from './vite-plugin-board-sync';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'test' ? [boardSyncPlugin()] : [])],
  build: {
    outDir: 'dist/client',
  },
  server: {
    port: 28432,
    strictPort: true,
    // Disable HMR in test mode to avoid WebSocket conflicts
    hmr: mode === 'test' ? false : undefined,
  },
}));
