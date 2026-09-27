# Implementation notes and decisions

## Story 1

- **`docs/architecture.md` is not in the repository.** `packages/shared/src/limits.ts` therefore holds
  the constants story 1 actually needs (`MAX_BODY_BYTES`, `DEPLOY_RETRY_ATTEMPTS`, client header, dev
  server host/port). Later stories add their own constants as their designs specify.
- **Root scripts call tools directly** (`vite build apps/web`, `vitest run ...`) instead of nesting
  `bun run --cwd ...`. They behave identically under `bun run <script>`, and they also work where
  `bun run` can't read the current directory (the sandbox these stories are built in hits a bun
  `CouldntReadCurrentDirectory` error, so verification there used `npm run <script>`).
- **workerd postinstall**: the same bun error stops workerd's lifecycle script. The root
  `postinstall` (`scripts/ensure-workerd.mjs`) re-runs workerd's `install.js` for every installed
  copy. It does nothing harmful when bun's own lifecycle script worked.
- `@cloudflare/vitest-pool-workers` 0.22 needs vitest 4.1 and uses the `cloudflareTest()` vite plugin
  instead of `defineWorkersConfig`. The configs use that plugin.
- TypeScript is pinned to 5.9 (TS 7's native compiler is too new for the toolchain), and Vite to 7
  with `@vitejs/plugin-react` 5.
- **Per-test D1 isolation**: pool-workers 0.2x removed `isolatedStorage`. `apps/api/test/setup.ts`
  restores D1 to its freshly-migrated state in a `beforeEach` (drops tables created by tests, empties
  migrated tables), which gives the same guarantee TC-I06 checks.
- **production-gate project**: it binds `ENVIRONMENT=production` inside Miniflare (still the base
  wrangler config and local D1). It also binds `TEST_SIMULATED_ENVIRONMENT=production`, which the
  setup guard accepts as "local, simulating production"; any other non-local value is refused.
- `compatibility_date` is 2026-08-15 because the workerd bundled with vitest-pool-workers only supports
  dates up to 2026-08-22.
- Playwright globalSetup logic lives in `assertLocalServer(baseURL, fetch)` so TC-I05 can inject a fetch.
  Its unit test runs in the node `unit` project (`e2e/*.unit.test.ts`).
- `validateRequest`: `hasBody` follows its contract exactly (Content-Length > 0 or Transfer-Encoding).
  When a request has no Content-Length, validation also measures the body with the bounded read, and
  any bytes found there count as a body for the JSON content-type rule, so a body can't dodge the 415
  by leaving out both headers.
- E2E: Playwright's `webServer` is `bun run dev` as designed. In the build sandbox `bun run` can't start,
  so the e2e run there used a server started with `npm run dev` (Playwright reuses an existing server
  outside CI) and `PLAYWRIGHT_BROWSERS_PATH` pointed at a writable cache.
- Deploy: `ENV_BASE_URLS` default to `*.workers.dev` placeholders (the custom domain is configured by hand,
  per the PRD) and can be overridden with `TODOODLE_STAGING_URL` / `TODOODLE_PRODUCTION_URL`.
- `verifyHealth`'s failure result also has a `message` (naming the environment, the expected sha and the
  last seen sha), so every caller reports the failure the same way.
- `withRetry` calls `onAttempt` once per attempt, after its outcome is known (with the error on failure).
- Deployment log rows end with `\n` (not RFC 4180's CRLF) to keep git diffs clean. Field quoting follows
  RFC 4180.
- `FsLike`/`GitLike` (scripts/deploy/types.ts) are minimal interfaces the design names but doesn't define.
- `buildHealth`/`Health` live in `packages/shared/src/health.ts` and are re-exported from
  `apps/api/src/routes/health.ts` (the design's location). This lets the node-side deploy tooling and
  its tests use the real health contract without pulling in Workers-only types.
- Release deps use `node:child_process` (bun implements it) instead of `Bun.spawn`, so the same real
  deps run under `bun scripts/deploy.ts` and inside vitest's node pool for the pipeline integration tests.
- The working-tree cleanliness check ignores `docs/ops/deployment-log.csv`. Every release appends to it,
  so otherwise the release right after would be refused until someone commits the log.
- The pending-migration list comes from filenames (`NNNN_name.sql`) found in the output of
  `wrangler d1 migrations list DB --env <env> --remote`.
- Production also refuses to run without an interactive terminal (it needs the confirmation prompt).
- `DeployDeps.config` (optional) overrides the base URL, paths and timings; the integration tests use it.

### Story 1 verification (2026-09-27)

- `typecheck`, `build` and `test` (unit 38 + 42, integration 26 + 14) pass; e2e (3 specs) passes against
  `wrangler dev` started from a fresh `.wrangler` state.
- Not verified here (as the design says): real releases to staging/production. The first staging release
  is the acceptance check, after filling in the D1 ids in `wrangler.toml` and the base URLs.
