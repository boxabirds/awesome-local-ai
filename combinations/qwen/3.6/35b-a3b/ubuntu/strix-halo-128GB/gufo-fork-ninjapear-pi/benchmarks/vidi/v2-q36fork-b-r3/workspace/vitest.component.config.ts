import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
    },
  },
  test: {
    name: 'component',
    include: ['tests/component/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/component/setup.ts'],
  },
});
