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
      // The afterEach eviction settle can wait just past the ~10 s local DO idle
      // eviction timeout; give the hook enough headroom for that.
      hookTimeout: 20000,
      pool: '@cloudflare/vitest-pool-workers',
      poolOptions: {
        workers: {
          main: 'src/worker/index.ts',
          wrangler: { configPath: 'wrangler.test.jsonc' },
          // singleWorker: use one runner worker (short name) for the whole
          // project. Without it the pool names the Durable Object storage dir
          // from the full absolute test-file path, which exceeds the 255-char
          // single-component limit on this deep workspace path.
          singleWorker: true,
          // Each test uses a unique boardId, so shared storage across tests is
          // safe. Isolated storage is disabled because workerd's DO WAL sidecar
          // files (.sqlite-shm) trip the pool's stacked-storage assertion.
          isolatedStorage: false,
        },
      },
    },
  }),
]);
