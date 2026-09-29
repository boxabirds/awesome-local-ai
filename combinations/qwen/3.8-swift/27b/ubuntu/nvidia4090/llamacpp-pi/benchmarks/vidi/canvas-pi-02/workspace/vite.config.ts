import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client is built to dist/client so `wrangler dev` serves it as static assets.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
  },
});
