import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` talks to the Worker running under `wrangler dev` for live rooms.
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
});
