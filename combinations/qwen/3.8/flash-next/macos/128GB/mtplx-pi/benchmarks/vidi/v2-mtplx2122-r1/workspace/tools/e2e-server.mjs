/**
 * Local server for the end-to-end tests.
 *
 * It runs the *real* Worker: `tools/build-e2e-worker.mjs` bundles
 * `src/worker/index.ts` and this script serves it through the workerd runtime
 * (Miniflare's programmatic API — the same engine `wrangler dev` uses), with
 * the `BOARD_ROOM` Durable Object namespace and the `ASSETS` binding pointed at
 * `dist/client`.  A browser hitting `http://127.0.0.1:<port>/b/<id>` therefore
 * goes through the same code path as a deploy: `/api/rooms/<id>` upgrades into
 * the Durable Object, everything else is served as a static asset with an SPA
 * fallback so that `/b/<id>` deep links resolve to the app shell.
 *
 * Started by `npm run test:e2e` (Playwright `webServer`).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workerEntry = path.join(root, '.tmp', 'e2e-worker', 'index.mjs')
const assetsDir = path.join(root, 'dist', 'client')
const port = Number(process.env.E2E_PORT ?? 25776)
const host = '127.0.0.1'

if (!existsSync(workerEntry)) {
  console.error(
    `[e2e-server] missing ${path.relative(root, workerEntry)} — run \`node tools/build-e2e-worker.mjs\` first`,
  )
  process.exit(1)
}
if (!existsSync(path.join(assetsDir, 'index.html'))) {
  console.error(
    `[e2e-server] missing ${path.relative(root, assetsDir)}/index.html — run \`npm run build\` first`,
  )
  process.exit(1)
}

const mf = new Miniflare({
  host,
  port,
  verbose: false,
  workers: [
    {
      name: 'vidi6',
      rootPath: root,
      modules: true,
      script: readFileSync(workerEntry, 'utf8'),
      compatibilityDate: '2025-02-14',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {
        BOARD_ROOM: { className: 'BoardRoom', useSQLite: true },
      },
      durableObjectsPersist: path.join(root, '.tmp', 'e2e-do'),
      assets: {
        directory: assetsDir,
        binding: 'ASSETS',
        // The Worker runs first (that is what `src/worker/index.ts` expects:
        // it handles `/api/rooms/*` and falls back to `env.ASSETS.fetch`).
        routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true },
        assetConfig: {
          not_found_handling: 'single-page-application',
          html_handling: 'auto-trailing-slash',
        },
      },
    },
  ],
})

try {
  await mf.ready
  console.log(`[e2e-server] listening on http://${host}:${port}`)
} catch (error) {
  console.error('[e2e-server] failed to start:', error)
  await mf.dispose()
  process.exit(1)
}

const shutdown = async () => {
  await mf.dispose()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
