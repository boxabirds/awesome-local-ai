import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ports are pinned inside the range allocated to this machine (see NOTES.md).
const PORT_DEV = 22885;
const PORT_PREVIEW = 22884;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: PORT_DEV,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: PORT_PREVIEW,
    strictPort: true,
  },
});
