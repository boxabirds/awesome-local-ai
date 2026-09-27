import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client-only build for story 1. `wrangler dev` serves `dist/client` (see wrangler.jsonc).
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
