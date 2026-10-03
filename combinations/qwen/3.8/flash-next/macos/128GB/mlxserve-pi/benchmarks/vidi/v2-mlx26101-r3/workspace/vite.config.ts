import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const DEV_PORT = Number(process.env.DEV_PORT ?? 23600);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // Stable asset names: `wrangler dev` builds its asset list when it starts, so hashed
    // file names would 404 for a dev server that is already running. Wrangler hashes
    // assets itself on deploy, and local files are served with no-cache.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
  },
});
