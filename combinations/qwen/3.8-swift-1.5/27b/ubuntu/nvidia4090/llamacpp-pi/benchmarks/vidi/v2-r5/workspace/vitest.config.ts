import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/{unit,component}/**/*.{test,spec}.{ts,tsx}'],
  },
});
