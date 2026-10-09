import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  },
});
