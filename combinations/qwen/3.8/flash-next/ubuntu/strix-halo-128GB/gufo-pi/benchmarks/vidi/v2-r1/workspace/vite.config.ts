import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static client build. `wrangler dev` serves `dist/client` (see wrangler.jsonc).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
});
