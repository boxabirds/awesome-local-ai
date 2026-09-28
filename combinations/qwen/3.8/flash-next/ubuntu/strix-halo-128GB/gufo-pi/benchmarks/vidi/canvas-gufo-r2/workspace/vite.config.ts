import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client build. Output goes to dist/client so `wrangler dev` (see wrangler.jsonc)
// serves the same static assets path used in production.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
