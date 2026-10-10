import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    // Bind the IPv4 loopback explicitly: 'localhost' resolves to ::1 here, which
    // makes the dev server unreachable at 127.0.0.1.
    host: '127.0.0.1',
    port: Number(process.env.DEV_PORT ?? 28402),
    strictPort: true,
  },
});
