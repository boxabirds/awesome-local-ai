import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// All ports stay inside the $AGENT_PORT_FIRST..$AGENT_PORT_LAST range.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 25506,
    strictPort: true,
  },
  build: {
    outDir: 'dist/client',
  },
});
