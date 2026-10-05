import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Three Vitest projects: pure logic in `node`, React components in `jsdom`, and
// integration tests that run inside workerd against the real Worker
// (`wrangler.jsonc`), with real Durable Objects and real WebSockets.
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
          // `undo.boundaries` needs to drive `Y.UndoManager`'s capture window from a
          // controllable clock. The manager reads the time through `lib0/time`, so the
          // library must run through Vite's module graph (not be externalised to a bare
          // `require`) for a `vi.mock('lib0/time')` in a test to reach it.
          server: { deps: { inline: ['yjs', 'lib0'] } }
        }
      },
      {
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx']
        }
      }
    ]
  }
});
