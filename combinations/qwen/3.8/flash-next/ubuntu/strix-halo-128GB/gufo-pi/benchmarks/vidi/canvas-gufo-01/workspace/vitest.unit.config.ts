import { defineConfig } from 'vitest/config';

// Pure logic: id generation, collision retry, configuration. Node environment,
// no DOM, no platform bindings.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
  },
});
