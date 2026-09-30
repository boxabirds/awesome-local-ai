import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.tsx'],
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      pool: '@cloudflare/vitest-pool-workers',
      poolOptions: {
        workers: {
          main: './src/worker/index.ts',
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            compatibilityDate: '2025-01-01',
            durableObjects: {
              BOARD_ROOM: { className: 'BoardRoom', useSQLite: true },
            },
            assets: {
              directory: './dist/client',
            },
          },
        },
      },
      server: {
        deps: {
          external: [/cloudflare:test/, /cloudflare:workers/],
        },
      },
    },
  },
]);
