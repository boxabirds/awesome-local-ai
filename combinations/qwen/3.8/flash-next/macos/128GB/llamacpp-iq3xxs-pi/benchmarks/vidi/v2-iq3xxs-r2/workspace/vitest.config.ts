import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        // Real Worker and Durable Object requests, run inside workerd itself: the room
        // is the unit under test, so none of it is mocked (design's mock-vs-real table).
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
          environmentOptions: {
            jsdom: {
              url: 'http://localhost:27424/',
              pretendToBeVisual: true,
            },
          },
        },
      },
    ],
  },
});
