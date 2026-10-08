import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// E2E test servers and local dev servers must use ports from
// $AGENT_PORT_FIRST..$AGENT_PORT_LAST (see NOTES.md).
const AGENT_PORT_FIRST = Number(process.env.AGENT_PORT_FIRST ?? 29104);
const AGENT_PORT_LAST = Number(process.env.AGENT_PORT_LAST ?? 29104);

export function agentPort(offset: number): number {
  const port = AGENT_PORT_FIRST + offset;
  if (port < AGENT_PORT_FIRST || port > AGENT_PORT_LAST) {
    throw new Error(`port ${port} is outside the allowed range`);
  }
  return port;
}

// Local dev server (vite) — offset 0 in the agent port range.
export const VITE_DEV_PORT = agentPort(0);

export default defineConfig({
  plugins: [react()],
  server: {
    port: VITE_DEV_PORT,
    strictPort: true,
  },
  build: {
    // wrangler serves dist/client as static assets (see wrangler.jsonc).
    outDir: 'dist/client',
  },
});
