import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// React pages and panels against mocked APIs: real DOM (jsdom), no network, no
// Workers runtime.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/component/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/component/setup.ts'],
    globals: false,
  },
});
