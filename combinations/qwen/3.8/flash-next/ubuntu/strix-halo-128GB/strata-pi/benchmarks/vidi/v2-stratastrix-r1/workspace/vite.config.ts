import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const PORT = Number(process.env.PORT ?? process.env.AGENT_PORT_FIRST ?? 26240);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    // Explicit, and inside the ports this machine may listen on.
    port: PORT,
    strictPort: true,
  },
});
