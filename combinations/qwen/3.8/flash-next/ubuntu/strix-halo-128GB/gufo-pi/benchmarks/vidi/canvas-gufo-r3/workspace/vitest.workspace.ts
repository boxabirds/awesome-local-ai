import { defineWorkspace } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import path from 'path';

const alias = {
  '@shared': path.resolve(__dirname, 'src/shared'),
  '@client': path.resolve(__dirname, 'src/client'),
};

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/component/setup.ts'],
    },
  },
  // Integration tests run inside the Workers runtime (workerd) with real
  // Durable Objects, WebSockets and Yjs via @cloudflare/vitest-pool-workers.
  defineWorkersProject({
    resolve: { alias },
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          // BoardRoom holds an open, accepted WebSocket, which keeps the object (and
          // its SQLite file) alive past a test boundary. Per-test isolated storage
          // tries to pop the storage frame and fails. Run tests serially in one
          // worker with shared storage; each test uses a unique board id, so rooms
          // never collide. singleWorker also keeps the DO storage directory name
          // short (per-file keys can exceed the filesystem limit).
          isolatedStorage: false,
          singleWorker: true,
        },
      },
    },
  }),
]);
