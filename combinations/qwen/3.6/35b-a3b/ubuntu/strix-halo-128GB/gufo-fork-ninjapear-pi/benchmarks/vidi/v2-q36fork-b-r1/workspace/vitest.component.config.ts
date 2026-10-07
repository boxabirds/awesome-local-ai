import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'component',
    globals: true,
    environment: 'jsdom',
    include: ['tests/component/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/component/setup.ts'],
  },
});
