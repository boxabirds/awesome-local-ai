import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

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
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      // Integration: real Worker + Durable Object + WebSockets + Yjs in workerd.
      // The client assets must be built first (see the test:integration script),
      // because wrangler.jsonc binds ASSETS to ./dist/client.
      defineWorkersProject({
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          poolOptions: {
            workers: {
              wrangler: { configPath: './wrangler.jsonc' },
              isolatedStorage: false,
            },
          },
        },
      }),
    ],
  },
});
