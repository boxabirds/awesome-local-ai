import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 20608,
    strictPort: true,
  },
});
