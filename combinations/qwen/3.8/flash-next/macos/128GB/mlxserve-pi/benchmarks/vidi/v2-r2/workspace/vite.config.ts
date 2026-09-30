import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is built to `dist/client`, which `wrangler dev` / `wrangler deploy`
// serve as static assets (see wrangler.jsonc). `npm run build:test` builds the
// same client with MODE=test so e2e can use the test hooks.
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
