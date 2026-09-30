import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Integration tests spawn a subprocess `wrangler dev` on a fixed port
    // (8899) per test file, so files MUST run one at a time: a second file
    // would adopt the first file's server and cascade-fail when it stops it.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
