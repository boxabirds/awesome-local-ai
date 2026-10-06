import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ports default to the range reserved for this agent (AGENT_PORT_FIRST..AGENT_PORT_LAST).
const DEV_PORT = Number(process.env.VIDI6_DEV_PORT ?? 28820);
const PREVIEW_PORT = Number(process.env.VIDI6_PREVIEW_PORT ?? 28821);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
  },
  preview: {
    port: PREVIEW_PORT,
    strictPort: true,
  },
});
