import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const INTEGRATION_PORT = process.env.INTEGRATION_PORT ?? '9111';
process.env.INTEGRATION_BASE_URL = `http://localhost:${INTEGRATION_PORT}`;

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/store/**'],
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
