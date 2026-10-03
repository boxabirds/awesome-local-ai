import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Dev server and e2e serve port (the sandbox allows a fixed port range). */
const PORT = Number(process.env.VIDI6_PORT ?? 28736);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
  },
});
