/**
 * Bundle the Worker for the local e2e server.
 *
 * `wrangler dev` needs network access and a file watcher, neither of which is
 * available in the sandbox, so the e2e server drives the *same* workerd runtime
 * through Miniflare's programmatic API instead.  This script bundles
 * `src/worker/index.ts` (with yjs/lib0/y-protocols inlined) into
 * `.tmp/e2e-worker/index.mjs`, which `tools/e2e-server.mjs` then runs.
 */

import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.tmp', 'e2e-worker')
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [path.join(root, 'src/worker/index.ts')],
  outfile: path.join(outDir, 'index.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['cloudflare:workers'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
})
