import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ports come from the agent allocation (AGENT_PORT_FIRST..AGENT_PORT_LAST).
const DEV_PORT = 20192;
const PREVIEW_PORT = 20193;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: { port: DEV_PORT, strictPort: true, host: '127.0.0.1' },
  preview: { port: PREVIEW_PORT, strictPort: true, host: '127.0.0.1' },
});
