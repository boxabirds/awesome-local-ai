/**
 * The bindings, as `cloudflare:test` hands them to a test.
 *
 * `@cloudflare/workers-types` declares `Cloudflare.Env` as an empty interface for exactly one reason: a
 * project is expected to redeclare it with its own bindings, and the two declarations merge into one. The
 * generated version of this file comes from `wrangler types`, which reads `wrangler.jsonc` — and this repo
 * does not keep generated files, so the same three lines are written here by hand next to the interface the
 * Worker itself is typed with, from which they take their types rather than repeating them.
 *
 * Without it, `import { env } from 'cloudflare:test'` in an integration test is an empty object as far as
 * `tsc` is concerned, and `env.ASSETS_BUCKET` is an error while the same expression in the Worker is not —
 * which is the kind of disagreement that makes a test file look wrong when it is the description of the
 * deployment that is out of date. Both are now the same interface, so they cannot disagree about whether this
 * board has a bucket.
 */

import type { Env as WorkerEnv } from './index';

declare global {
  namespace Cloudflare {
    // The Worker's own `Env` is the one place the bindings are written down; this adds no members of its own
    // so that adding a binding in `wrangler.jsonc` and in `index.ts` is one change rather than two.
    interface Env extends WorkerEnv {}
  }
}

export {};
