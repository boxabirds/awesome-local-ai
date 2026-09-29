import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
    },
  },
  root: 'src/client',
  define: {
    'import.meta.env.MODE': JSON.stringify(mode),
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
}));
