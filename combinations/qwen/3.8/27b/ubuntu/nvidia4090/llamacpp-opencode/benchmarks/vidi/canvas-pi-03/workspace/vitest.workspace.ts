import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const alias = {
  '@': path.resolve(__dirname, 'src'),
};

export default defineWorkspace([
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
      globals: true,
    },
  },
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/component/setup.ts'],
      globals: true,
    },
  },
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      // Integration runs against a REAL `wrangler dev` (real worker + real
      // Durable Object + real WebSockets). The Cloudflare vitest pool's
      // bundled workerd drops WebSocket frames delivered through an
      // in-worker DO stub, so WS assertions must go through the production
      // workerd that `wrangler dev` uses. A single server is shared by all
      // files (global setup) and files run serially.
      name: 'integration',
      environment: 'node',
      include: ['tests/integration/**/*.test.{ts,tsx}'],
      globalSetup: path.resolve(__dirname, 'tests/integration/global-setup.ts'),
      fileParallelism: false,
      globals: true,
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  },
]);
