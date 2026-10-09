import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
          // Story 8 capture-timeout tests mock lib0/time, which yjs imports;
          // yjs must go through the module runner for that mock to apply.
          server: { deps: { inline: ['yjs'] } }
        }
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/component/setup.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'integration',
          pool: 'forks',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 90_000,
          hookTimeout: 180_000
        }
      }
    ]
  }
});
