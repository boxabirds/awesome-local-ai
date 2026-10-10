import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['./tests/component/setup.ts']
        }
      },
      defineWorkersProject({
        test: {
          name: 'integration',
          pool: '@cloudflare/vitest-pool-workers',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          poolOptions: {
            workers: {
              wrangler: { configPath: './wrangler.jsonc' },
              main: './src/worker/index.ts',
              // Live DO websockets outlive a single test, so per-test storage
              // snapshots cannot be restored. Tests never share state because
              // every board id is random.
              isolatedStorage: false
            }
          }
        }
      })
    ]
  }
});
