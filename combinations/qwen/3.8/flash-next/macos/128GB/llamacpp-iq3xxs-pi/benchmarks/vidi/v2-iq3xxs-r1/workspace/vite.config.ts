import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client build. Static assets land in dist/client (served by wrangler).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 25234,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 25235,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
