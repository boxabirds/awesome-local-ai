import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client-only build for now: `dist/client` is served as static assets by the
// Cloudflare Worker configured in wrangler.jsonc (Worker code arrives in story 3).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // Inside the port range assigned to this task ($AGENT_PORT_FIRST);
    // DEV_PORT overrides it.
    host: '127.0.0.1',
    port: Number(process.env['DEV_PORT'] ?? 21056),
  },
});
