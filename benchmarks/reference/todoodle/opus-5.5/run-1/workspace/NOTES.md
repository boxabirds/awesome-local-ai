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

## Story 3

- **Commit order.** Task 7 (forget dialog) was committed before task 6 (Home list), because task 6 depends on
  `preloadForgetDialog`. Task 13 (NotFound recovery, instant name) was committed before the test tasks 9–12, which
  exercise it. `removeRemembered` landed with task 2's cookie helpers; `RememberedPublic`/`RememberedListResponse`
  landed with task 2 because `lib/remembered.ts` needs them.
- **Secure attribute.** TC-09 says Secure "only for staging and production". Story 2's TC-13 also expects Secure when
  `ENVIRONMENT` is missing (fail-safe). The one builder (`rememberedCookieHeader`) therefore omits Secure only for
  `local`, which satisfies both.
- **Malformed vs absent cookie.** Story 2's codec turns anything unparseable into `[]`. Story 3 needs to heal a
  malformed cookie, so `cookie.ts` adds `decodeRememberedStrict` (null when the value as a whole cannot be decoded)
  and `parseRememberedCookie` (`absent | ok | malformed`). An empty `tdl_ws=` value counts as absent. With the binary
  codec, TC-25's "bad JSON" and "schema failure" cases are base64url JSON values, which fail the version/length check.
- **Touch fires once per mount.** `useTouchRemembered` uses `staleTime`/`gcTime: Infinity` as the design says, plus
  `refetchOnMount: 'always'`. Otherwise reopening a workspace later in the same session would not move it back to
  the front (TC-81).
- **useOpenWorkspace.** Story 2 has no `useOpenWorkspace` hook; opening by link is `fireOpen` in `bootOpen.ts`. The
  remembered-list invalidation and the dropped notice are called from its success callback (and from
  `useCreateWorkspace`'s `onSuccess`). `notifyDropped` is the plain function; `useDroppedNotice()` returns it.
- **Switcher trigger.** The workspace name in the header is story 2's inline rename input, so it cannot also be the
  menu trigger. The switcher is a chevron button labelled "Switch workspace", next to the name. The list query in the
  switcher is enabled only once the menu is opened (and prefetched on trigger hover/focus), so workspaces that never
  open it make no extra request. Menu items are marked current with `aria-current="page"` and a check icon.
- **Copy link in the forget dialog.** `useWorkspaceLink` (story 2) gained `fetchLink()`. It runs `refetch()` on the
  disabled query and resolves the link or rejects. The dialog then calls `copyText(link)` with a string, as the
  design says. Unlike the Share panel, a manual copy in the fallback field does not set the saved flag.
- **Instant name while the route chunk loads.** React 19 throttles revealing Suspense content (about 300 ms). So even with a
  cached chunk, the header could stay a skeleton past TC-92's 200 ms. The `/w/:workspaceId` Suspense fallback
  (`RememberedWorkspaceFallback`) therefore also reads `rememberedPlaceholder` and shows the name in the skeleton
  header. After the chunk loads, `workspaceQuery`'s `placeholderData` keeps it until GET answers. The placeholder
  fills `version: 0, createdAt: ''`, because only id and name are known. Editing stays off while
  `isPlaceholderData` is true.
- **Rename refreshes the remembered list.** Found by e2e TC-90: after a rename, the cached list (used by NotFound, the
  switcher and the placeholder) showed the old name. `useRenameWorkspace` now also invalidates `['remembered']`.
- **Story 2 tests touched.** Three story 2 UI tests asserted the exact request list on `/w/:id` or NotFound. They now
  include story 3's touch request and the recovery list request (the rest of each assertion is unchanged). MSW now
  has default handlers (empty remembered list, touch 204). The shared test teardown dismisses sonner toasts, because
  sonner replays active toasts to the next mounted Toaster.
- **Touch sizing.** The `touch-target` utility (`@media (hover: none)` → 44px minimum) lives in `index.css`.
  happy-dom evaluates no media queries, so UI TC-71 asserts the classes. The real layout is checked by e2e TC-91 in
  a new `mobile-touch` Playwright project (iPhone 13, WebKit), which runs only `*.mobile.spec.ts`.
- **axe.** `axe-core` was added as a web dev dependency. The UI tests run it on Home, NotFound and the forget dialog,
  with `color-contrast` and `region` off: happy-dom does no layout, and contrast is covered by story 2's token tests.
- `POST /test/remembered-seed {count}` (1–50) creates workspaces named `Seeded 1` (newest) to `Seeded N` (oldest) and
  sets a cookie remembering exactly them. Like every `/test/*` route, it returns 404 in production.
- Story 3 verification: typecheck (all five tsconfigs), lint, build, unit (api 69, deploy 48, web 47), integration
  (api 76, deploy 18), UI (92) and e2e (51 across chromium, webkit and mobile-touch, run twice) all pass. As in stories
  1–2, `bun run <script>` cannot run in this sandbox, so each script's underlying binary was run directly against a
  manually started `wrangler dev`.

## Story 4

- **Commit order.** Task 6 (LiveProvider and the client live modules) was committed before task 5, because task 5 wraps the
  workspace in `LiveProvider`. `backoff.ts` landed with task 6, because `LiveConnection` needs it. The integration tests
  written to verify tasks 2–3 were committed with task 10.
- **Story 2 names differ from the design.** The design's `WorkspaceShell` is `WorkspaceView` in `routes/Workspace.tsx`, and its
  `WorkspaceName.tsx` is `features/workspace/WorkspaceNameEditor.tsx`. Story 2 had no `features/share/copy.ts`, so story 4 adds
  it: it holds the panel's statement text, and `SharePanel` and the tests read it from there.
  Story 2's stub `features/live/canEditStore.ts` was replaced by the design's `canEdit.ts`. The story 2 edit-gate UI test
  therefore mocks `@/features/live/canEdit`, keeping the module's other exports via `importOriginal`. Its assertions are unchanged.
- **Edit-gate fieldsets.** Share sits inside the header, so one fieldset cannot wrap the header's name editor while leaving
  Share outside. There are two fieldsets, both driven by the same `useCanEdit()` boolean: the header's own fieldset around the
  name editor (story 2), and one around the sidebar and main areas. Share, the switcher and the unsaved-link banner stay outside both.
- **Constants.** Besides the design's table, `limits.ts` gains:
  - `LIVE_RECONNECT_MAX_MS = 30_000`: the backoff cap the tests expect.
  - `LIVE_PING_INTERVAL_MS = 20_000`.
  - `LIVE_PING`/`LIVE_PONG`.
  - `LIVE_UPDATE_TARGET_MS = 5_000`.
  - `LIVE_FRAME_FALLBACK_MS = 100`: a fallback timer in case a hidden tab never fires the animation frame.
  - `CLIENT_ID_HEADER_NAME`.
  `LIVE_OFFLINE_AFTER_MS` never existed, so there was nothing to retire.
- **Event union.** The design lists 8 type literals, but TC-E01 says "9 valid variants". TC-E01 parses one valid event of every
  type (all 8) and asserts the list equals `LIVE_EVENT_TYPES`. `ProjectDTO`/`TaskDTO` are loose `{id, version}` placeholders
  for stories 5 and 7.
- **No-op rename.** Renaming to the current name now returns 200 without writing: no version bump and no broadcast (TC-B06).
  Before this story every rename bumped the version.
- **Not found on the socket.** Browsers hide the HTTP status of a refused upgrade, and auth fails before the upgrade, so the server
  never sends close 4404 today. The client handles 4404 anyway. When a socket fails before it ever opened, it also asks
  `GET /api/w/:id`: a 404 means `not_found` (terminal, no retries, the route shows Not Found). Any other answer keeps retrying.
- **Socket states.** `reconnecting` lasts from a drop until the next open, including the retry attempts, so the status does not flip
  back to `connecting` on every attempt. While the network is offline no attempts are made. When the network comes back, the
  socket reconnects at once with a fresh backoff. The client pings once as soon as the socket opens, then every interval. The first
  pong proves the path end to end, and the e2e tests wait for it before acting.
- **api.ts and the live feature.** They are decoupled through `setConnectivityHooks` (installed by `network.ts` and `canEdit.ts`),
  so there are no import cycles. The `OfflineError` guard covers workspace edits (`request(..., {edit: true})`: rename now, and
  stories 5–8 add theirs). Create, open, touch and forget are not workspace edits. The health probe never reports its own
  failure. `request` is exported for later stories, and HTTP 410 maps to `GoneError`.
- **Conflict UX details (name editor).**
  - While a conflict is open, leaving the field does not commit or close the notice. Escape closes the editor, which keeps theirs.
  - After a choice, the editor stays open if the field still has focus, and closes otherwise.
  - The notice's buttons keep focus on mousedown, so a click does not blur (and close) the editor.
  - The editor-closed toast uses sonner's action/cancel buttons, with the description `Now: <their value>`.
  - A rename draft typed before going offline is kept even if the browser blurs the field as it becomes disabled.
- **Announcer.** The polite region has `aria-label="Changes by others"`, which keeps story 2's query for the unnamed name-hint
  status unique. Each announcement is a fresh node keyed by a sequence number, so a repeated message is announced again. The
  `workspace.updated` handler also patches the name in the cached remembered list (switcher, Home) without refetching.
- **Test placement and mechanics.**
  - The design's `apps/api/test/share-join.test.ts` lives in `test/integration/`, the only folder the integration project runs.
  - TC-B04 calls `app.fetch` directly with a throwing `WORKSPACE_ROOM` in `env`, because a binding cannot be overridden through `SELF`.
  - workerd will not construct a Durable Object around a fake `ctx`. The TC-R01/R02 unit tests therefore call the room's methods
    on a prototype-linked object carrying a fake `ctx`, and the constructor's ping/pong auto-response is checked with
    `runInDurableObject`.
  - UI tests use `mock-socket` servers, and the story 2/3 UI tests get an inert socket by default (`test/support/sockets.ts`).
  - TC-O10 uses fake timers with `shouldAdvanceTime`, so MSW and `waitFor` still run. The exact 4,999/5,000 ms boundary is
    pinned in the unit tests.
- **E2E.** `e2e/live.spec.ts` runs on Chromium only, as the design says (clipboard permission, offline emulation, WebSocket
  routing); its tests are skipped on WebKit. W8 starts from an unrenamed workspace. Otherwise A's own rename at creation falls
  within A's 10 s recent-edit window, and B's rename correctly raises a conflict notice for A, which holds A's next commit until
  A chooses a version.
- **wrangler.** The Durable Object binding is repeated under `env.staging` and `env.production`, because bindings are not
  inherited. The DO migration (`tag = "v1"`) is top-level, and `wrangler deploy --dry-run --env staging` lists the binding with
  no warnings.
- **Story 4 verification.** Everything below passes:
  - typecheck (all five tsconfigs), lint and build;
  - unit: api 84, deploy 48, web 122;
  - integration: api 104, deploy 18;
  - UI: 114;
  - e2e: 59 passed and 8 skipped (story 4 on WebKit) across chromium, webkit and mobile-touch. The story 4 specs were also run
    3 times in a row on Chromium with no failures.

  As in stories 1–3, `bun run <script>` cannot run in this sandbox, so each script's underlying binary was run directly against
  a manually started `wrangler dev`.
