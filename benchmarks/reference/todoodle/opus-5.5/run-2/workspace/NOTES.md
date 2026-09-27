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

## Story 2

- **Dependencies.** `bun add` downloads packages but then hits the sandbox's
  `CouldntReadCurrentDirectory` error before it writes `package.json`, so the new dependencies
  (react-router, @tanstack/react-query, radix-ui, sonner, lucide-react, zod, eslint,
  typescript-eslint) were added to the package.json files by hand at the installed versions;
  `bun.lock` was written by bun.
- **Workspace ids are lowercase hex** (`lower(hex(randomblob(16)))`). The design writes
  `hex(randomblob(16))`, which is uppercase; lowercase matches the cookie codec's "32 hex" rule
  either way and reads better in URLs (`/w/:id`).
- **`tdl_ws` cookie encoding is packed binary, not base64url(JSON).** base64url(JSON) of 50
  entries is about 7 KB, so TC-12 (Set-Cookie under 4096 bytes at 50 entries) could not pass.
  The value is base64url of `[version byte][16-byte id][32-byte secret][uint32 t]...` (3.5 KB at
  50 entries). Decoding still never throws: anything with the wrong alphabet, version byte or
  length reads as `[]` (a base64url(JSON) value included). Entries that can't be packed are left
  out when encoding. The exported functions and `RememberedEntry` shape are as designed.
- **Non-JSON bodies stay 415 `unsupported_media_type`.** The story 2 design says a body with a
  non-JSON content type is 403 `forbidden_client` (TC-19), but story 1's validate middleware owns
  that rule and its tests (TC-P05, TC-P20) pin 415. The design says story 2 consumes the rule
  rather than redefining it, so TC-19 asserts 415 and an unchanged row count.
- **Sanitised logger keeps the error message.** Story 1's TC-P13 requires the thrown error's
  message in the log; `logRequestError` logs `{requestId, method, pathname, status, errorName,
  errorMessage}` and nothing from the request (the stack is no longer logged).
- **Workers invocation logs are off** (`invocation_logs = false`) for staging and production.
  The manual check of staging Workers Logs (task 7 step 6) can't be done from the build sandbox;
  invocation logs record request metadata, so they are turned off pre-emptively rather than
  after the check. Our own sanitised `console.error` lines are still kept.
- **Commit order.** Tasks 8-11 depend on tasks 16-18 (link endpoint, linkSaved/copyText/banner,
  theme tokens), so those were committed right after task 11 and before the test tasks 12-15.
  Every commit still carries its own task number and title.
- **Create error text uses the PRD's em dash**: "Couldn't create your list — try again". The
  design and tasks write it with a hyphen; the PRD is the source for what users see.
- **NotFound has a small `h1` "Todoodle" (link home) and the `h2` "Workspace not found".** Story 1's
  e2e test expects an `h1` named Todoodle on `/w`, which is now the not-found page (empty hash).
- **One dialog serves as Dialog and Sheet.** `components/ui/dialog.tsx` is a centred dialog from
  `MOBILE_BREAKPOINT_PX` (640px, Tailwind `sm`) up and a full-width bottom sheet below it, with
  full-width buttons; a separate shadcn Sheet component would duplicate it.
- **SharePanel focus return.** The panel opens from plain buttons, not a Radix `Dialog.Trigger`, so
  Radix has no trigger to refocus; the panel remembers what had focus when it opened and refocuses
  it on close (TC-46).
- **Email in save mode also closes the panel** (PRD: "After copying or emailing, the panel is
  closed"). It closes on the next tick so the `mailto:` navigation is handed off first.
- Bookmark hint text: "Press ⌘D to bookmark this page." / "Press Ctrl+D to bookmark this page.".
  Rename failure toast: "Couldn't rename the workspace — try again.".
- **Just-created workspaces render from cache.** `bootOpen.ts` keeps an in-memory (never
  persisted) secret -> workspace id map filled by create and open, so `/w#secret` renders
  immediately with no skeleton and no second request after creation. Opens are shared per secret
  (`openForRoute`), so re-renders and StrictMode don't repeat them; Try again discards the failed one.
- `workspaceQuery` uses `staleTime` 10 s and `retry: false`: no GET straight after an open that
  already returned the workspace, focus refetches after that, and a 404/5xx surfaces at once.
- The name editor shows the mutation's pending name while a rename is in flight (TanStack's
  "optimistic via variables"), so the old name never flashes before the cache write lands.
- **Extra token `warning-surface`** (banner background), with `foreground` on it in the text pairs.
  All token pairs and the 12 project colours pass the contrast test in both themes.
- **Per-icon lucide imports.** lucide-react 1.x has no subpath exports, so `lucide-react/icons/<name>`
  is a Vite/vitest alias to `dist/esm/icons/<name>.mjs` with an ambient type declaration
  (`src/types/lucide-icons.d.ts`). The lint rule allows type-only imports from the package root.
- **Lint** runs `eslint apps/web` (flat config in `apps/web/eslint.config.js`); `test` runs it first.
- **Web tests** are two vitest projects: `web-unit` (part of `test:unit`) and `ui` (`test:ui`).
  Component tests render inside an awaited `act()`: React 19 does not retry a component that
  suspended on `use()` inside a synchronous act scope. Test-only reset hooks
  (`resetBootOpenForTests`, `resetLinkSavedCacheForTests`) stand in for a fresh page load.
- **`/test/seed-workspace`** (non-production only) creates a workspace, optionally soft-deleted,
  for TC-25/TC-32. `workspaces` is registered with `/test/reset`.
- **E2E**: Playwright runs chromium and webkit. In webkit the clipboard is forced to refuse (init
  script) so the manual-copy fallback is what gets tested, as the design specifies. `bun run dev`
  now applies local migrations first (a fresh checkout works), and the Playwright global setup
  empties the local D1 through `/test/reset`. The sandbox run used a server started with
  `npm run dev` (see story 1's note).

### Story 2 verification (2026-09-27)

- `build`, `typecheck`, `lint` and `test` pass: api unit 69, scripts unit 42, api integration +
  production-gate 66, scripts integration 14, web unit + ui 110. E2E: 28 passing (chromium + webkit,
  including story 1's specs) against `wrangler dev` with a freshly migrated local D1, 3 runs in a row.
- Not verified here: the manual Workers Logs check on staging (task 7 step 6); see the invocation
  logs note above.
