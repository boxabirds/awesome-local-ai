import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server must listen on a port from $AGENT_PORT_FIRST..$AGENT_PORT_LAST.
const devPort = Number(process.env.AGENT_PORT_FIRST ?? 5173);

export default defineConfig({
  plugins: [react()],
  build: {
    // wrangler.jsonc serves this directory as static assets.
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: devPort,
    strictPort: true,
  },
});
