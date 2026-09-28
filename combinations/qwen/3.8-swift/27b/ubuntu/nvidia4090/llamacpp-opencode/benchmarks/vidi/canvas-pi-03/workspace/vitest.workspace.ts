import { defineWorkspace } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const alias = {
  'src': path.resolve(__dirname, 'src'),
};

export default defineWorkspace([
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
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
    },
  },
  // Integration tests run inside workerd (real Worker + Durable Objects +
  // real WebSockets + real Yjs) via the Cloudflare Vitest pool.
  defineWorkersProject({
    resolve: { alias },
    test: {
      name: 'integration',
      environment: 'node',
      include: ['tests/integration/**/*.test.{ts,tsx}'],
      pool: '@cloudflare/vitest-pool-workers',
      poolOptions: {
        workers: {
          main: 'src/worker/index.ts',
          wrangler: { configPath: 'wrangler.test.jsonc' },
          // Each test uses a unique boardId, so shared storage across tests is
          // safe. Isolated storage is disabled because workerd's DO WAL sidecar
          // files (.sqlite-shm) trip the pool's stacked-storage assertion.
          isolatedStorage: false,
        },
      },
    },
  }),
]);
