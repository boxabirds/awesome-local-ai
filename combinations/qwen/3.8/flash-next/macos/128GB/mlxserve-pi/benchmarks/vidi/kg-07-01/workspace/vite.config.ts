import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `npm run dev` serves the client only; live sync needs the Worker running too (`npx wrangler dev`, port 8787).
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
