import { fileURLToPath } from 'node:url';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import react from '@vitejs/plugin-react';
import { type UserConfig, defineConfig } from 'vitest/config';

/** One entry of `test.projects`. */
type VitestProject = NonNullable<NonNullable<UserConfig['test']>['projects']>[number];

/**
 * Vitest resolves a custom pool id with `require`-style export conditions, which
 * `@cloudflare/vitest-pool-workers` does not publish, so point at the pool's own file.
 */
const WORKERS_POOL = fileURLToPath(
  new URL('node_modules/@cloudflare/vitest-pool-workers/dist/pool/index.mjs', import.meta.url),
);

/**
 * The integration project, through the Cloudflare helper (which is what adds the `workerd`
 * resolve conditions and the `cloudflare:test` module). The helper's types describe a
 * standalone config file with the pool named by its package id; this repo extends the root
 * config and names the pool by its file, so the types are lined up by hand here.
 */
const integrationProject = defineWorkersProject({
  extends: true,
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    pool: WORKERS_POOL,
    // A board is only interesting while its sockets are open, so a test is given room to
    // hold six of them and let frames arrive.
    testTimeout: 20_000,
    poolOptions: {
      workers: {
        // The pool's isolated storage cannot be stacked around a Durable Object that
        // outlives the test that opened it, which is the whole point here: one board, many
        // participants, several tests per run. (See NOTES.md.)
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
} as never) as unknown as VitestProject;

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
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          // Both extensions: a test of how the client reads a close code needs no JSX to write.
          include: ['tests/component/**/*.test.tsx', 'tests/component/**/*.test.ts'],
          setupFiles: ['./tests/component/setup.ts'],
        },
      },
      // Story 3: the Worker and the BoardRoom room are the unit under test, so these run in
      // the real runtime (workerd) with a real Durable Object, real WebSockets and real Yjs.
      integrationProject,
    ],
  },
});
