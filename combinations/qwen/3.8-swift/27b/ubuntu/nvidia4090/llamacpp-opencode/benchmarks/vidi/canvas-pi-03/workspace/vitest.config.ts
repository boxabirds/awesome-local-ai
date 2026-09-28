import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Root config; the projects (unit / component / integration) are declared in
// vitest.workspace.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'src': path.resolve(__dirname, 'src'),
    },
  },
});
