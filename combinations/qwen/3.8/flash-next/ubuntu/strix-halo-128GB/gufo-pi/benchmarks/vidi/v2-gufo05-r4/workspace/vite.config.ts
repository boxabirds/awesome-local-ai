import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the vidi6 client. `wrangler.jsonc` serves `dist/client` as static assets.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
  },
  server: {
    port: 21328,
    strictPort: true
  },
  preview: {
    port: 21329,
    strictPort: true
  }
});
