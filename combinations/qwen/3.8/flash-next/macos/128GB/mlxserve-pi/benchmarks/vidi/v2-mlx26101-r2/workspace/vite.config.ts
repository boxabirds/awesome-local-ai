import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server must listen on a port from $AGENT_PORT_FIRST (see NOTES.md);
// override with DEV_PORT when that port is busy.
const DEV_PORT = Number(process.env.DEV_PORT ?? process.env.AGENT_PORT_FIRST ?? 5173);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // Explicit IPv4 loopback: with the default ('localhost') vite binds ::1 here,
    // and http://127.0.0.1:$DEV_PORT then refuses the connection.
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
  },
});
