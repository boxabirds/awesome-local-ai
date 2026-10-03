import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/board-room.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
