import { defineWorkspace } from 'vitest/config';
import { resolve } from 'path';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**'],
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@client': resolve(__dirname, 'src/client'),
      },
    },
  },
  {
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**'],
      setupFiles: ['tests/setup.ts'],
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@client': resolve(__dirname, 'src/client'),
      },
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      pool: '@cloudflare/vitest-pool-workers',
      poolOptions: {
        workers: {
          main: 'src/worker/index.ts',
          compatibilityDate: '2024-01-01',
          durableObjects: {
            BOARD_ROOM: 'BoardRoom',
          },
        },
      },
      server: {
        deps: {
          external: [/cloudflare:test/],
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@client': resolve(__dirname, 'src/client'),
      },
    },
  },
]);
