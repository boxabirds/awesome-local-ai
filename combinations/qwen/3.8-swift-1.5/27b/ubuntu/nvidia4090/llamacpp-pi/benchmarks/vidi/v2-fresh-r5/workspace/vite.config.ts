import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Absolute asset paths: the SPA serves /b/:boardId routes, so relative
  // `./assets/...` URLs would resolve against the board path and 404 into
  // the index.html fallback (MIME error for module scripts).
  base: '/',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 20610,
    strictPort: true,
  },
});
