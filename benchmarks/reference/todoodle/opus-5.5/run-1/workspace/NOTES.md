# Implementation notes and decisions

## Story 1

- `docs/architecture.md` is referenced by the design but not present in `spec/`. `packages/shared/src/limits.ts`
  therefore holds the constants story 1 needs (MAX_BODY_BYTES = 1 MB per the PRD, DEPLOY_RETRY_ATTEMPTS = 3,
  client header name/value, local dev port). Later stories append their own constants.
- `@cloudflare/vitest-pool-workers` 0.22 (the release compatible with vitest 4) replaced `defineWorkersConfig`
  with the `cloudflareTest()` vite plugin and dropped the `isolatedStorage` option. The api vitest config uses
  `cloudflareTest()`; per-test storage isolation is achieved by calling `reset()` from `cloudflare:test`
  in the setup file before each test (then re-applying migrations).
- The sandbox this story was built in blocks bun from reading parent directories, so `bun run <script>` / `bunx`
  fail there with `CouldntReadCurrentDirectory` and bun sees no environment variables. All scripts are still
  declared as bun scripts; verification was done by invoking the same underlying binaries
  (`node_modules/.bin/vitest`, `wrangler`, `vite`, `tsc`, `playwright`) directly.
- `scripts/dev.ts` launches `vite build --watch` and `wrangler dev` directly from `node_modules/.bin`
  instead of nesting `bun run` calls.
- Release tooling (`scripts/deploy/deps.ts`) uses `node:child_process`/`node:fs` rather than `Bun.spawn`, so the
  same real dependencies run under bun (the CLI) and under vitest's node pool (integration tests).
- `verifyHealth` failures also carry a `message` naming the environment and last seen revision (the contract's
  `{ ok: false, lastSeenSha }` plus one field). Fetch-typed parameters use a minimal `FetchLike` type because bun's
  `typeof fetch` includes `preconnect`.
- `DeployDeps` gained an optional `baseUrl` (overrides `ENV_BASE_URLS[env]`) so integration tests can point the
  release at a real local health server. `ENV_BASE_URLS` holds placeholder domains until the real ones exist.
- The clean-tree precheck ignores `docs/ops/deployment-log.csv`. Otherwise every release would dirty the tree and
  block the next one until the log was committed.
- Pushing the deploy tag is skipped (and logged) when the repository has no git remote.
- `buildHealth` lives in `apps/api/src/routes/health.ts` but depends only on `ReleaseVars` (`apps/api/src/release-vars.ts`),
  so node-side tests can build real health fixtures without the Workers type globals.
- `compatibility_date` is 2026-08-20: the workerd bundled with `@cloudflare/vitest-pool-workers` 0.22 supports
  dates only up to 2026-08-22.
- Simulated staging/production for integration tests: extra vitest projects (`api-staging-sim`, `api-production-gate`)
  override `ENVIRONMENT` (and release vars) as Miniflare bindings. They still load only the base (local)
  `wrangler.toml`. The node-side config asserts that base environment is `local`, and the in-worker setup asserts it
  again (and asserts `ENVIRONMENT === 'local'` for every non-simulated project).
- `TEST_RESET_TABLES` is an exported mutable array. Integration tests register a throwaway `test_scratch` table
  with it to prove `/test/reset` (story 1 owns no real tables). Later stories add their tables in source.
- The Playwright `webServer` runs `bun run dev` and reuses an already running server outside CI.
