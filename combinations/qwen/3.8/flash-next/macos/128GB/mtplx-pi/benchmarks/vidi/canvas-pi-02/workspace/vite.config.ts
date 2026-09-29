import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client-only build: static assets land in dist/client, which wrangler serves
// (see wrangler.jsonc). Story 3 adds the Worker entry point.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
  },
});
