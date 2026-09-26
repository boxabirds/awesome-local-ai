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

## Story 2

- **Cookie encoding is binary, not JSON.** The design says `base64url(JSON.stringify(entries))` but also requires (TC-12)
  the Set-Cookie string to stay under 4096 bytes at 50 entries. JSON at 50 entries is about 5.3 KB before base64
  (about 7 KB after), so the two requirements conflict. The codec (`apps/api/src/lib/cookie.ts`) packs
  `[version byte][16-byte id][32-byte secret][uint32 t]` per entry and base64url-encodes that: about 3.5 KB at 50
  entries. The exported contract (`readRemembered`, `upsertRemembered`, `serializeRememberedCookie`, `findEntry`,
  `RememberedEntry {id, s, t}`) is unchanged; `encodeRemembered`/`decodeRemembered` are also exported for tests
  and story 3. Malformed values (bad base64, wrong version, truncated) decode to `[]`; invalid entries are dropped.
- Workspace ids come from the design's `hex(randomblob(16))` default, which is **uppercase** hex. The codec
  validates and emits uppercase ids.
- Story 1's validate middleware answers a body with a non-JSON Content-Type with **415 unsupported_media_type**
  (story 1 tests TC-P05/TC-P20). Story 2's TC-19 expects 403 for that case. The task says to consume story 1's rule and
  add one only if absent, so story 1's rule is kept: TC-19 asserts the request is rejected before the handler
  (415) and no row is created. A missing client header is still 403 (TC-18, TC-38).
- Sanitised API logger (`logRequestError` in `apps/api/src/lib/errors.ts`) logs `{requestId, method, pathname, status,
  errorName}` plus the error's own `errorMessage`. Story 1's TC-P13 requires the thrown error's message in the log;
  stack traces, headers, cookies, bodies and query strings are never logged.
- Task 7's manual step (inspect staging Workers Logs after a deploy) could not be done here: no staging deploy exists
  yet. As the conservative choice, `invocation_logs = false` is set for staging and production in `wrangler.toml`, so
  request metadata (including Cookie headers) is never captured. Only the sanitised console logs remain. Re-check this
  after the first staging deploy.
- The create-failure message uses the PRD's wording with an em dash, 'Couldn't create your list — try again'. The
  design's TC-42 writes it with ' - ', which reads as an ASCII rendering of the PRD text.
- Lucide icons are imported per icon as `lucide-react/icons/<name>`, as the design requires. lucide-react 1.x has no
  `exports` map, so `vite.config.ts` aliases that path to `dist/esm/icons/<name>.mjs` and `src/lucide-icons.d.ts`
  declares its type.
- The `/w#secret` open is a module-level promise that never rejects (`OpenResult` is `ok | not_found | failed`), read
  with React 19 `use()`. After create, `primeOpen` stores an already-settled promise, so the route renders at once
  with no skeleton and no open request.
- Web tests are split into two vitest projects in `apps/web/vitest.config.ts`: `web-unit` (`apps/web/test/unit`,
  run by `test:unit`) and `web-ui` (component tests, run by `test:ui`).
- Task 12 lists TC-85 (token contrast) and TC-91 (import lint), but both test task 18's artifacts, so they are
  committed with task 18.
- UI tests render through an async `act` (`renderApp` in `apps/web/test/support/render.tsx`). Under React 19 a `use()`
  suspension that starts inside a synchronous `act()` render is never retried in happy-dom, so the initial render
  (and the load-failed 'Try again' click) must go through async act. Real browsers are unaffected.
- The SharePanel is opened from a header button that is not a Radix `Dialog.Trigger`, and Radix only restores focus to
  its own trigger. The panel therefore records the focused element when it opens and returns focus to it on close.
- The name editor shows the submitted name until the rename mutation settles (`mutateAsync`), then the cached name
  again. An optimistic update and its rollback can land in one render batch, so following the cache alone could
  leave the rejected text in the field.
- Theme colours are hex values in `packages/shared/src/tokens.ts`, so the contrast tests read exactly what ships.
  `bun run tokens` regenerates `apps/web/src/styles/tokens.css`, and a unit test fails if the committed CSS drifts.
- The import lint uses `@typescript-eslint/no-restricted-imports` rather than the core rule, so `import type` from the
  `lucide-react` root stays allowed (types have no runtime cost; `src/lucide-icons.d.ts` needs `LucideIcon`).
  `bun run test` runs `bun run lint` first.
- Tasks were committed in dependency order rather than strictly by number: 16 (link endpoint) and 17 (banner) before
  14 (UI tests, which exercise them), and 18 (tokens and lint) before 15 (e2e, whose dark-mode case needs the tokens).
  The `linkSaved`/`copyText` modules were committed with task 10, the first task that needed them.
- CSP compatibility (story 1's `default-src 'self'`, no inline styles). Three libraries tried to break it, and each is
  neutralised without loosening the policy:
  - sonner injects its CSS with a runtime `<style>`. A Vite transform disables the injection, and
    `sonner/dist/styles.css` is bundled from `index.css`.
  - Radix's scroll lock (react-remove-scroll via `react-style-singleton`) injects `<style>` tags. `react-style-singleton`
    is aliased to a no-op (`src/lib/cspStyleSingleton.ts`), and the essential `body[data-scroll-locked]` rules ship in
    `src/styles/scroll-lock.css`. The scrollbar-gap compensation is dropped.
  - zod v4 probes `new Function`, which the CSP reports. `z.config({ jitless: true })` is set in the shared schemas.
  The e2e WF-1 test asserts no console (CSP) errors across create/save/share and that the modal still locks scroll.
- E2E: Playwright runs chromium (with real clipboard permissions) and webkit. Playwright cannot grant WebKit clipboard
  access, so WebKit specs make `writeText` reject (an init script) and assert the manual-copy fallback, as the design
  prescribes. `e2e/global-setup.ts` now also POSTs `/test/reset` after proving the server is local, so each run starts
  from an empty database. The webServer command applies local migrations before `bun run dev`.
- In this sandbox `bun run dev` cannot start (bun cannot read its cwd or see PATH when spawned), so e2e was verified
  against a manually started `wrangler dev` plus `vite build` (Playwright reuses an existing server outside CI).
- The panel returns focus to the header's Share button (`data-share-trigger`) when it closes, as a Radix
  `Dialog.Trigger` would. WebKit does not focus buttons on click, so "the element focused when it opened" is not
  enough there.
- Story 2 verification: build, typecheck (all five tsconfigs), lint, unit (api 57, deploy 48, web 40), integration
  (api 56, deploy 18), UI (54) and e2e (26: 13 per browser) all pass. `bun run <script>` cannot run in this sandbox
  (`CouldntReadCurrentDirectory`, as in story 1), so each script's underlying command was run directly.
