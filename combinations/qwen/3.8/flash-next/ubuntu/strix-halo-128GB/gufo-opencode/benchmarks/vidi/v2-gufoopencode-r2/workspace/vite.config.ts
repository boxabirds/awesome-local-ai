import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = Number(process.env.PORT ?? 29424);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: DEV_PORT + 1,
    strictPort: true,
  },
});
