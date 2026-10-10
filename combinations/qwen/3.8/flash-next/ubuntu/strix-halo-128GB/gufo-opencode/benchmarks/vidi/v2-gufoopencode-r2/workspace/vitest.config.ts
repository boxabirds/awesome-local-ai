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
          // yjs measures the UndoManager capture window with lib0's
          // getUnixTime (= Date.now captured at import time). Inlining lets
          // tests vi.mock('lib0/time') so vi.setSystemTime controls it
          // (undo-boundaries TC-12/TC-13); see NOTES.md.
          server: { deps: { inline: ['yjs', 'lib0'] } },
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'component',
          globals: true,
          environment: 'jsdom',
          include: ['tests/component/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
});
