import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is built to dist/client so that the Cloudflare Worker (added in
// story 3) can serve it as static assets via wrangler.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
});
