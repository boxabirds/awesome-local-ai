import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is a static SPA built to dist/client and served by the Worker's
// assets binding (single-page-application fallback -> index.html).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
});
