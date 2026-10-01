import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/{unit,component}/**/*.{test,spec}.{ts,tsx}'],
    // Inline yjs/lib0 so vi.mock('lib0/time') reaches yjs's internal time
    // reads (undo capture-timeout tests need a controllable clock).
    server: {
      deps: {
        inline: ['yjs', 'lib0'],
      },
    },
  },
});
