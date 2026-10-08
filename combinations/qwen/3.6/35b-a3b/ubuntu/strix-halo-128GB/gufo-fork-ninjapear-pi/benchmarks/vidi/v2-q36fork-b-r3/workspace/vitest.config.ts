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
    name: 'unit',
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    globals: true,
  },
});
