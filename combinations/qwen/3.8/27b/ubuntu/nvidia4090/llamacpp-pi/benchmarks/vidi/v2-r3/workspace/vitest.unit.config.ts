import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Inline yjs (and its lib0 deps) so vi.mock of a lib0 module (e.g.
    // lib0/time for the undo capture-timeout boundary tests) also applies to
    // yjs's own internal imports, which Node would otherwise load natively.
    server: {
      deps: {
        inline: ['yjs', 'lib0'],
      },
    },
  },
});
