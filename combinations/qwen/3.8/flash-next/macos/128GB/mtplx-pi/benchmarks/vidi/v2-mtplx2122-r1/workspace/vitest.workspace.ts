import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
      globals: true,
      // Inline yjs + lib0 so a test can `vi.mock('lib0/time')` to drive the
      // UndoManager capture window (undo-boundaries).  Without inlining, the
      // yjs bundle is externalised and reads the real `Date.now`.
      server: { deps: { inline: ['yjs', 'lib0'] } },
    },
  },
  {
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.{ts,tsx}'],
      globals: true,
      setupFiles: ['./tests/component/setup.ts'],
    },
  },
])
