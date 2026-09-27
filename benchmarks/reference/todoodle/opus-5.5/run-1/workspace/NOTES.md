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

## Story 5

- **Commit order.** Tasks were committed in dependency order: 1, 2, 3, then the API test tasks 8, 9, 10 (they only need tasks
  1–3), then 4, 5, 15 (the shortcut registry, which quick add needs), 6, 7, 16 (the phone layout, which TC-120 needs), and
  finally the web test tasks 11, 12, 13, 17, 18 and the e2e task 14. `taskCache.ts` and the MSW task handlers landed with
  task 4, because the list query already merges unsaved rows.
- **Test locations.** The vitest projects only run `apps/api/test/{unit,integration}` and `apps/web/test/{unit,ui}`, so the
  design's paths are mapped there: `apps/api/test/integration/tasks.{db,create,list}.test.ts`,
  `apps/api/test/unit/taskSchemas.test.ts` (the design's `packages/shared/test/schemas.test.ts`: `packages/shared` has no
  test project), `apps/web/test/unit/tasks/*` and `apps/web/test/ui/tasks/*`. MSW task handlers are in
  `apps/web/test/msw/tasks.ts`, as designed.
- **Length limits count UTF-16 code units.** The installed zod counts code points in `.max()` for strings, so an emoji-heavy
  name could pass the server while the client's counter said it was over. `CreateTaskInputSchema` uses an explicit
  `String.length` refine for both limits (TC-30 pins the emoji case).
- **Breakpoint constant.** `MOBILE_BREAKPOINT_PX` was 640 (story 2's Share sheet). Story 5 needs 768 under that name, so the
  sheet's value was renamed `SHEET_BREAKPOINT_PX = 640` (only a doc comment used it) and `MOBILE_BREAKPOINT_PX = 768`.
  Media queries can't read custom properties, so CSS uses Tailwind `md` (48rem = 768px, pinned by a unit test) and
  `useIsNarrow()` builds `(max-width: 767.98px)` from the constant.
- **constants.css** is generated by the existing `bun run tokens` script (now writing `tokens.css` and `constants.css`)
  rather than a Vite plugin. A unit test fails if the committed file drifts from `limits.ts`.
- **No route loaders.** The app uses React Router's declarative `<BrowserRouter>`, which has no `loader`. `workspaceLoader({params})`
  keeps the loader shape and is called wherever a workspace id first becomes known: `main.tsx` at boot on `/w/:id`, when open by
  link resolves (`bootOpen`), in Home's hover/focus prefetch, and in an effect on the `/w/:id` route (a no-op when fresh).
  `primeOpen` (right after create) seeds an empty Inbox and `{inbox: 0}`, so a brand-new workspace makes no list requests.
- **Existing names kept.** The query-key factory is story 2's `queryKeys` (the design's `qk`); `queryKeys.tasks(id)` without a
  filter is still the prefix story 4 invalidates. Story 4's broadcast helper is `broadcast(c, workspaceId, event)` (the design's
  `broadcastEvent(env, ctx, …)`). The live registry calls handlers once per event inside a per-frame `notifyManager.batch`, so
  the tasks handler applies each event with the batch-capable `applyTaskEvents(list, [event])`. `TaskDTO` in the event union
  stays loose (story 4 tests use minimal tasks); the tasks handler validates entities with `TaskSchema` and ignores others.
- **Timeout.** `CREATE_TASK_TIMEOUT_MS` uses an `AbortController` plus `setTimeout` instead of `AbortSignal.timeout`, so vitest
  fake timers drive TC-70. `useMutation` has one key per workspace (`['ws', id, 'createTask']`), and every callback works on
  the task id in its variables, so retries of different tasks never interfere.
- **Offline interplay (story 4).** A create that fails at network level (including a timeout or a lost response) also takes the
  app offline, which disables Retry/Discard (they sit inside the edit fieldset) until the health probe answers. On recovery the
  list is refetched: rows the server already has replace their failed copies (same id), and unsaved rows are kept
  (`mergeLocalRows`). So e2e TC-82 has two cases: a 502 after the server committed (Retry replays the same id → 200, one task)
  and a connection reset after commit (the row heals to the server copy, one task).
- **Row callbacks and memo.** Retry/Discard come from `TaskRowActionsContext` (a `useMemo` over the stable mutation functions).
  `TaskRow` exports a render counter (`taskRowRenders`) used only by TC-45 and TC-110.
- **Q and focus.** Escape returns focus to the opener: the '+ Add task' button, the FAB (looked up again, since it unmounts while
  docked), or for Q whatever had focus before (a task row, or Share right after the link panel closes). Q while quick add is open
  refocuses its name field. Q in the phone layout opens the docked box.
- **Empty state on touch screens** reads "Your Inbox is clear. Tap + to add a task." (the PRD gives only the second sentence
  for phones; the first is kept for continuity).
- **Loading region.** The skeleton region is a `<section aria-label="Loading tasks" aria-busy="true">` (a labelled region), and
  story 3's `WorkspaceSkeletonRows` is now a `<div>` because it renders inside the shell's `<main>`.
- **Existing tests touched.** Two story 2 tests (TC-64, TC-65) list the exact requests of `/w/:id`; they now include the Inbox's
  `GET tasks` and `GET counts`. MSW's default handlers serve an empty Inbox. The story 2 e2e WF-5 recorded headers with
  `allHeaders()`, which never settles for a request cancelled by a navigation (more likely now that the Inbox loads on
  reload); it falls back to the request's reported headers after 2 s. Its assertions are unchanged.
- **E2E.** `e2e/tasks.spec.ts` runs on Chromium and WebKit; `e2e/tasks.mobile.spec.ts` runs in the mobile-touch project (iPhone 13)
  and adds an iPad (gen 7) group for TC-97. axe is evaluated in the page (no injected script, so the CSP is untouched). WebKit's
  default Tab order skips buttons, so the keyboard-only workflow opens quick add with Q.
- **Story 5 verification.** Everything below passes:
  - typecheck (all five tsconfigs), lint and build;
  - unit: api 109, deploy 48, web 174;
  - integration: api 152, deploy 18;
  - UI: 182;
  - e2e: 92 passed and 8 skipped (story 4 on WebKit) across chromium, webkit and mobile-touch, three full runs; the story 5
    specs also passed 3 times in a row (`--repeat-each=3`).

  As in stories 1–4, `bun run <script>` cannot run in this sandbox, so each script's underlying binary was run directly against
  a manually started `wrangler dev`.

## Story 6

- **Commit order.** Tasks 1–3, then the API test tasks 9 and 10 (they only need tasks 1–3), then 4, 5, 13 (focus), 6, 7,
  8, 11 and finally 12. Some commits hold another task's code:
  - Task 3's PATCH route, `updateTask` and `listTasks` share `db/tasks.ts` and `routes/tasks.ts` with task 2, so they landed
    in task 2's commit. Task 3's commit is empty and says so.
  - `TaskDetailSheet.tsx` and its lazy loader landed with task 6. Task 6's rows preload the sheet and `InboxView` renders
    it. Task 7's commit is empty and says so.
  - Task 4's action controller exposes hooks (`setTaskActionHooks`). Tasks 5 and 13 plug the undo toast and focus
    management into them (`features/tasks/wireTaskActions.ts`), so each of those tasks is its own commit.
- **Test locations.** TC-U01..U07 (shared schemas and ordering) are in `apps/api/test/unit/taskEdit.schemas.test.ts`, as in
  story 5, because `packages/shared` has no test project. TC-U15 (Intl dates) is in `apps/web/test/unit/tasks/dates.test.ts`,
  since workerd's Intl locale data is not the browser's. All other unit tests are in `apps/web/test/unit/{tasks,undo}`. The
  UI tests are in `apps/web/test/ui/tasks/taskActions.test.tsx` and `taskDetail.test.tsx`, backed by a stateful MSW task
  server (`test/msw/taskLifecycle.ts`). The integration tests are `tasks.lifecycle.test.ts` and `tasks.edit.test.ts`.
- **No `/test/seed` endpoint.** The design's e2e and integration fixtures mention `/test/seed`, but it never existed.
  Seeding goes through the real create endpoint, which is the quick-add path. Integration tests then set
  completed/deleted states directly in D1 (`seedRealisticWorkspaces`), and e2e uses `seedTasks`. The design's
  "fractional sort_order" is not reproduced: the quick-add path only produces integer steps. `GET /test/tasks/:id/raw` was
  added as designed.
- **Query keys.** `queryKeys.tasks(id, {list})` now normalises to `['ws', id, 'tasks', {list, includeCompleted: false}]`,
  so story 5 call sites name the same entry. Story 5's TC-92 key assertion was updated to the new shape. Story 5's quick add
  writes its optimistic row into both variants of a list (the include-completed one only when it is cached), placing it
  before the completed rows.
- **Cache model.** Every cached list keeps one order: open by `sortOrder`, then completed by `completedAt` descending. A
  just-completed task stays in place with `leaving: true` for `COMPLETE_ANIMATION_MS`, then moves. Under reduced motion it
  moves at once and never gets the flag or the `task-row-leaving` class.
  - Rollback is per task (`rollbackTask`). The failed task goes back beside its old neighbours, and other rows keep any
    concurrent change. Whole-list snapshot rollback would undo a concurrent delete of another task.
  - "Busy" is a tiny external store (`taskBusy.ts`) rather than `useIsMutating`, because the actions are plain functions,
    not per-task `useMutation` keys.
- **Actions are a per-workspace controller** (`createTaskActions`, cached per QueryClient and workspace). They are not
  `useMutation` hooks. Undo toasts outlive components and must call stable functions, which is the design's "stable refs"
  point. The `useCompleteTask`/`useReopenTask`/`useUpdateTask`/`useDeleteTask`/`useRestoreTask` hooks return those functions.
- **Undo semantics.**
  - Undo inverses are not optimistic. The task comes back when `reopen`/`restore` succeeds, and on failure it stays
    completed or deleted on screen with "Couldn't undo — try again" (TC-C22).
  - The undo toast appears when the complete or delete succeeds, not before. An Undo pressed before the server has the
    change could otherwise race it.
  - "Task restored" (role=status) follows a successful undo of either kind.
- **Toast roles.** sonner's toasts have no role, so failures and successes use `toast.custom` with our own `role="alert"`
  or `role="status"` card (`lib/notify.tsx`). The undo toast is a `role=status` region holding the Undo button.
- **Shortcut registry changes (story 5's `lib/shortcuts.ts`).**
  - A handler may return `false` to decline a key. The key is then not prevented, and an earlier registration may take it.
    Row shortcuts decline when no task row has focus (so Space still presses buttons, and so on), and Cmd/Ctrl+Z declines
    when no undo toast is active (native text undo is untouched).
  - `mod` shortcuts no longer match with Shift held (Cmd+Shift+Z is redo).
  - The panel shows `' '` as Space and `Delete` as Del.
- **Row structure (a11y).** axe's nested-interactive rule (serious) fails any focusable widget inside `role=option`, even
  with `tabindex=-1`. The row's checkbox (`<span role=checkbox>`), name and '…' trigger (`<span role=button>`) are therefore
  pointer and touch targets that never take focus. Keyboard users act on the focused row with Space, E and Delete (the menu
  shows these hints, with `aria-keyshortcuts`). The option is named by its task name (`aria-labelledby`).
  - Menu choices run from `onCloseAutoFocus`, after the menu has released focus, so focus lands where the action puts it.
  - Story 5's rows keep Retry/Discard buttons on unsaved rows.
- **Space only on the row itself.** On any other element (a button, the switch), Space keeps its native meaning.
- **Detail sheet.**
  - Edits are held as "dirty" drafts (`null` shows the saved value), and only dirty fields are passed to story 4's edit
    guard. Someone else's change to a field the user has not touched just shows up, with no conflict notice. A change to a
    field being edited raises the notice (TC-C19). While the notice is open, the field keeps the user's text and the notice
    shows theirs.
  - A 410 on save goes through story 4's `handleMutationError`, which removes the task and toasts "This task was deleted".
    The sheet closes because its task has left the cache.
  - The sheet unmounts before focus moves (`flushSync`), because Radix's focus trap would pull focus back.
  - The description is trimmed on save, like create.
- **Live events.** Story 6 also registers a `task.deleted` handler (not only `task.restored`). Without it the dispatcher
  would invalidate the whole workspace and never tell the edit guards, so the deleted notice (TC-E05) could not show.
  `task.upserted` now moves a completed or reopened task between the open and completed rows of every cached list.
- **Constants.**
  - `NAME_HINT_MS` is 3,000 (was 2,500, story 2). Story 2's TC-80 title quoted the old numbers; it now names the constant.
  - `COMPLETE_ANIMATION_MS` reaches CSS as `--complete-animation-ms` through the generated `constants.css`.
  - Shared and web TypeScript `lib` moved to ES2023 for `toSorted`/`toSpliced`/`with` (supported by every browser the
    app targets, and by workerd).
- **Show completed.**
  - The toggle is a `role=switch` at the top of the list. It adds one Tab stop before the list, so story 5's TC-109/TC-111
    (UI) and TC-114 (e2e) now step over it. WebKit's default Tab order skips buttons, so TC-114 only presses the extra Tab
    on Chromium.
  - The workspace loader prefetches whichever Inbox variant this browser remembers.
  - The design's "400 on include_completed -> alert and toggle off" branch is not built. The client only ever sends
    `true`, and any failed list load already shows story 5's "Couldn't load your tasks" with Try again.
- **Undo toast pause.** Hover and focus-within are tracked separately, and the window resumes only when both have left.
  sonner shows the toast with an infinite duration, and `createUndo` alone decides when it goes.
- **E2E.**
  - `e2e/tasks.lifecycle.spec.ts` runs on Chromium only (design: standards-only APIs), and its tests skip on WebKit.
  - `e2e/tasks.lifecycle.mobile.spec.ts` runs in the iPhone project.
  - Playwright's Desktop Chrome device reports Windows, so the app expects Ctrl for mod+z even on a Mac host. `modKey(page)`
    asks the page which modifier it uses. Native select-all still uses `ControlOrMeta`.
  - The sheet's full-screen box is measured after its slide-in animation.
- **Story 6 verification.** Everything below passes:
  - typecheck (all five tsconfigs), lint and build;
  - unit: api 132, deploy 48, web 232;
  - integration: api 207, deploy 18;
  - UI: 235;
  - e2e: 100 passed and 15 skipped (story 4 and story 6 desktop specs on WebKit) across chromium, webkit and mobile-touch.
    The story 6 specs also passed 3 times in a row (`--repeat-each=3`).

  As before, `bun run <script>` cannot run in this sandbox (`CouldntReadCurrentDirectory`), so each script's underlying
  binary was run directly against a manually started `wrangler dev` with a fresh `vite build`.

## Story 7

- **Commit order.** Tasks were committed in dependency order: 1–4 (API), then the API test tasks 11–14 (they only need
  1–4), then 5, 18 (tasks.md says to do it before 6), 6, 7, 8, 9, 19, and the test tasks 10, 15, 16, 17.
  - Task 6's commit carries a stub `routes/ProjectView.tsx` (heading only), because sidebar rows preload that chunk.
    Task 7 replaces it.
  - Task 18's commit holds NameField, nameFieldState, ColorPalette and ProjectDot. The sidebar's 44px hit areas and
    touch-visible '…' landed with the sidebar (task 6).
  - `smoke.tmp.mjs`, a throwaway browser script, was committed by mistake with task 10 and removed in task 17.
- **Palette.** Story 2's `tokens.ts` already had a `PROJECT_COLORS` key list and `PROJECT_COLOR_TOKENS`.
  - `limits.ts` now owns `PROJECT_COLORS` as the design's `{key, label, light, dark}`, plus `PROJECT_COLOR_KEYS`.
  - `tokens.ts` derives `PROJECT_COLOR_TOKENS` from it, so `tokens.css` (`--project-<key>`) is unchanged.
  - The keys are story 2's (`red`…`pink`, not the design's example `berry`). Labels are plain colour names.
  - The measured ratios are listed in a comment. All are at least 4.18 against the light background and muted
    surfaces, and 5.07 against the dark ones. TC-83 checks both surfaces in both themes.
- **Counts.** `CountsSchema.projects` defaults to `{}`. The exported `Counts` type is the schema's input type, so
  pre-story-7 fixtures (`{inbox: n}`) still type-check. Story 5 tests that compared a whole counts response now
  expect `projects: {}`.
  - The `/counts` query is a UNION of a per-project LEFT JOIN and the Inbox count, in one statement. An empty project
    counted one open task through the LEFT JOIN's null row; the integration test TC-04 caught it (fixed in task 11).
- **Live event shapes.** The event union's `entity` envelope is kept:
  - `project.deleted` carries `{id, batchId}`;
  - `tasks.bulk` carries `{ids, deleted}`;
  - each `tasks.bulk` holds at most `TASKS_BULK_MAX_IDS` (400) ids, so a large project stays under
    `LIVE_MAX_EVENT_BYTES`.
- **Live counts refresh.** The project handler refetches counts on `task.upserted` only when the event or the cached
  copy involves a project. Inbox changes are already counted exactly by story 5's handler, and refetching on every
  event made a story 5 test's static fixture overwrite the count. Every project refetch uses
  `cancelRefetch: false`, so several events in one frame share one request.
- **Scope-aware task caches (story 5/6 code changed).** With several lists cached, a task must only ever sit in lists
  of its own scope:
  - `queryKeys.tasks` takes `{list: 'project', projectId}`. The Inbox key shape is unchanged.
  - Story 5's live `applyTask` removes a task from lists of other scopes (a move).
  - Story 6's `writeLists` takes an optional project filter for the writes that can insert (reopen, undo, move).
  - `adjustCount` moves project counts, including `total`.
  - `InboxView` became a thin wrapper over the new `TaskListView`, which the project view reuses.
- **Routing.** The project route is a sibling `<Route path="/w/:workspaceId/project/:projectId">` with the same
  element as `/w/:workspaceId`, rather than a nested child route. Switching views therefore keeps the workspace
  (and its live socket) mounted.
  - `WorkspaceView` renders the lazy `ProjectView` when the param is present.
  - The sidebar's current view is derived from the address. `AppShell` therefore now needs a router and a
    `WorkspaceContext`; story 5's TC-126 test wraps it in both.
- **No cmdk or vaul.** Neither is installed, and nothing can be installed here. The shared combobox pieces are built
  on Radix instead:
  - `ResponsiveCommand` is a Radix `Popover` anchored to the task row with `virtualRef`, or a `Dialog` without an
    anchor, or a bottom `Sheet` (new `side="bottom"`) below `MOBILE_BREAKPOINT_PX`.
  - The listbox is our own: `role=combobox` input with `aria-activedescendant`, and `OptionRow` options.
  - The filtering is ours, as the design wants (cmdk's `shouldFilter={false}`).
- **Move to… filter.** Matching is a case- and accent-insensitive *substring* match, as the PRD says ("contain the
  typed text"). The design's TC-80 row expects 'WORK' to give only Work, but 'Woodwork' contains 'work'. The unit
  test follows the PRD: 'WORK' gives Work and Woodwork.
- **Create flow.** The row appears in the sidebar at once (optimistic), but the dialog stays open until Todoodle
  answers, and only then navigates to the project. This lets 409 `limit_reached` show in the dialog (TC-55) and
  keeps a failed create's text (TC-54). Navigating first would load a project the server does not have yet.
  - `id_conflict` regenerates the id and retries once.
- **Delete / Undo.** As in story 6, the Undo toast appears once the DELETE has succeeded, so an Undo can never race
  the delete (the design's "chain the restore after the pending delete" cannot occur).
  - `showUndoToast` gained `restoredText` ('Project restored').
  - After a confirmed delete, focus goes to the Projects heading. After Cancel it goes back to the '…' trigger.
  - Deleting the project on screen navigates to the Inbox before the cache write.
  - A small "known gone" set (`projectGone.ts`) stops the project view from also saying 'Project not found', both
    for this tab's own deletes and for live deletes by others.
- **UI details decided here:**
  - The project empty state on touch screens reads 'No tasks yet. Tap + to add one.', like story 5's Inbox.
  - An over-long inline rename stays open on Enter or blur. Nothing is cut and nothing is sent; Escape cancels.
  - A repeated blank rename restarts the hint's `HINT_VISIBLE_MS` timer.
  - Colour swatches select on focus (radio semantics). Radix's own arrow-key selection depends on keyup timing,
    which happy-dom does not reproduce.
  - 'Project not found' is `role=alert`; 'This project was deleted' is `role=status`.
  - On phones and touch screens the list keeps room below its last row, so the floating add button never covers a
    row's '…' (found by W9).
- **Test locations.**
  - TC-02 (safety scan of the real `0003_projects.sql`) is `scripts/test/migration-0003.test.ts`.
  - The shared-schema tests (TC-48) and the pure decisions (TC-73, TC-74) are in `apps/api/test/unit`, as in stories
    5 and 6. So is TC-93 (`normaliseForSearch`), which then runs in workerd, where story 11's server will call it.
  - Web unit tests are in `apps/web/test/unit/{projects,tasks}`. UI tests are in `apps/web/test/ui/projects`, backed
    by a stateful MSW server (`test/msw/projectServer.ts`).
  - E2E: `e2e/projects.spec.ts` (Chromium only; it skips on WebKit, as the design says) and
    `e2e/projects.mobile.spec.ts` (the iPhone 13 device, at the design's 390×844; Playwright's preset viewport is
    390×664).
- **`/test/sql`** (non-production only) runs one SQL statement. TC-29 uses it to install and drop the trigger that
  aborts the project UPDATE, proving the delete batch is atomic.
- **Existing tests touched.**
  - The request lists of `/w/:id` (story 2 TC-64 and TC-65, story 5 TC-91) now include `GET projects`.
  - The keyboard walks (story 5 TC-109, TC-111, e2e TC-114) step over the new 'Add project' Tab stop.
  - `primeOpen` also seeds an empty projects list, so a just-created workspace still makes no list requests.
- **Integration tests run one file at a time.** With the new project delete/restore tests running beside story 4's
  10-socket room tests, the local workerd process sometimes exited mid-run ("Worker exited unexpectedly"). About 2 in
  5 full runs lost story 4's `live.test.ts`. Bisecting pointed at load, not at any assertion: the old files alone
  never crashed, and neither did any pair of files. `fileParallelism: false` on `api-integration` removed the crash
  (0 in 9 runs), at about 33 s instead of 10 s.
- **Story 7 verification.** Everything below passes:
  - typecheck (all five tsconfigs), lint and build;
  - unit: api 166, deploy 49, web 274;
  - integration: api 273 (with the staging and production simulations), deploy 18;
  - UI: 276;
  - e2e: 110 passed and 24 skipped (the story 4, 6 and 7 desktop specs on WebKit) across chromium, webkit and
    mobile-touch. The story 7 specs also passed 3 times in a row (`--repeat-each=3`).

  As before, `bun run <script>` cannot run in this sandbox (`CouldntReadCurrentDirectory`), so each script's
  underlying binary was run directly against a manually started `wrangler dev` with a fresh `vite build`.

## Story 8

- **Commit order.** Task 5 (the clock store) was committed before task 3, because task 3's counts `queryFn` reads
  `getLocalDateSnapshot()`. `todayCache.ts` (the Today cache helpers and the mirror used by the task actions) landed
  with task 4. `apps/api/test/support/dates.ts` and `reschedule.test.ts` were written while building task 4 (TC-58
  proved `json_each` first) and committed with task 9. `bun.lock` landed with task 6. Fixes found by later tasks are
  in those tasks' commits and say so (task 10: the picker's height, the Today count on live events; task 11: live
  handler order and the idle chunk preload); the final commit holds the progressive Today rows and the perf project.
- **Existing names kept.** The design's `taskSchema`/`createTaskSchema`/`updateTaskSchema` are the existing
  `TaskSchema`/`CreateTaskInputSchema`/`TaskPatchSchema`. `TaskSchema.dueDate` defaults to null like `projectId`, so
  pre-story-8 payloads still parse. There was no idempotent-create body comparison to extend: a replay answers with the
  stored row (stored values win), so a retried dated create never makes a second row (TC-100).
- **`/test/seed`** is new (the design assumed it existed; story 6 noted it did not). It seeds projects (optionally
  deleted exactly as a project delete does) and tasks through the same insert statements as the API, in batches, then
  marks tasks completed or deleted. The perf fixtures (5,000 tasks) go through it.
- **`json_each` works in D1** (TC-58 passes against Miniflare D1), so the chunked `IN (...)` fallback was not built;
  `D1_MAX_BOUND_PARAMS` exists only as the named setting. D1 refuses `RETURNING tasks.*` on `UPDATE … FROM`, so the
  restore lists its columns. Reschedule and restore broadcast `tasks.bulk` split by story 7's `TASKS_BULK_MAX_IDS`
  (one event up to 400 ids), only when something changed.
- **Labels.** Recent ICU spells September 'Sept' in en-GB short months; the PRD shows 'Sep', so the date formatter
  shortens a four-letter 'Sept' month part. Chip and picker labels use `navigator.language` (the design); UI tests stub
  it to en-GB and the e2e contexts use `locale: 'en-GB'`. The picker's accessible names use the full form
  ('Tomorrow, Saturday 26 September').
- **Picker.** Built on Radix Popover and react-day-picker 9 (week starts Monday). The shadcn CLI's current output
  imports a `cn` package and wants react-day-picker 10, so `components/ui/popover.tsx` and `calendar.tsx` are the
  shadcn components adapted by hand. The lazy panel lives in `src/features/dates/picker/DueDatePickerPanel.tsx`: the
  import lint (story 2) already allowed `date-fns` only under `src/features/dates/picker/**`. `lazyWithRetry`
  returns `{load, loaded}` (a module, not a component) and the picker opens once the module arrived, because
  `React.lazy` caches a rejection forever. The popover never grows past the room it has (it scrolls).
- **Row pickers.** D (and a click on a row's date, and a new 'Set due date… D' item in the row menu) opens a picker
  store like story 7's Move to…; `RowDatePickerHost` in the shell renders it anchored to the row's `[data-chip-slot]`.
  The chip itself is a `role=img` with the screen-reader label as its name, so the row (an `option`) never contains a
  focusable control (story 6's nested-interactive rule).
- **Today and the task actions.** Today is its own cache (`['ws', id, 'today', {date, includeCompleted}]`), not a
  task list, so story 6/7's task actions now also call `mirrorTaskToToday` at each optimistic write, success and
  rollback: the Today rows and the Today count stay in step with complete, reopen, edit (dates), delete, move and undo
  from any view, and quick add. `find` falls back to cached Todays, so a task only Today holds can be acted on. The
  reschedule and undo are a per-workspace controller (`createRescheduleActions`) rather than `useMutation`, like
  story 6's actions, because the undo toast outlives the view; it snapshots the Today and counts caches and rolls
  back on failure. `showUndoToast`'s `restoredText` may be a function (null: the inverse reported the outcome), so a
  partial undo says only 'N task(s) … were not restored' and a full one 'Due dates restored'.
- **Quick add on Today** targets the Inbox ('→ Inbox') with the local date preselected; a picked date other than
  today adds the task and says 'Added to Inbox'. Story 5's `{kind: 'today'}` quick-add target stays unused. Opening a
  task from Today uses the same detail sheet (it reads the Today cache); changing its date so it leaves Today closes
  the sheet, like any task leaving the list it was opened from.
- **Live refresh.** Today's handlers are registered before story 5's (AppShell): they must see a task's cached copy
  before it is replaced, so a collaborator clearing a date still refreshes the Today count (found by e2e TC-91).
  Besides refetching cached Todays (debounced), they refetch counts when a dated task changed, because the story 5/7
  count handlers do not track `today`; undated changes never refetch (story 5's static test fixtures are unaffected).
  `project.upserted` is handled too (renamed projects change row tags).
- **Performance.** TC-94/TC-118 pass without virtualization (about 290 ms to the first Today rows; the slowest
  keystroke event during a 500-task reschedule plus a live bulk change was about 40 ms). Two things were needed:
  the Today chunk also preloads when the browser is idle (otherwise React 19's Suspense reveal throttle added about
  300 ms to a first visit), and each Today group renders its first `TODAY_FIRST_RENDER_ROWS` (50) rows at once and the
  rest in a deferred render, so a cached Today with 2,000 rows never renders them in one blocking pass. `row-cv` is on
  every task row (lists too), never a container. Playwright's clock also fakes `performance.now()`, so the perf specs
  use the real clock with dates relative to the real London date.
- **E2E layout.** `e2e/today.spec.ts` (Chromium only, as designed; London, en-GB, `page.clock` at Fri 2026-09-25) and
  `e2e/today.perf.spec.ts`, which runs in its own `perf` Playwright project with one worker: timings taken while
  other specs load the same local server measured the machine, not Todoodle. `test:e2e` runs the other projects,
  then `perf`.
- **Existing tests touched.** Keyboard walks (story 5 UI TC-109/TC-111, e2e TC-114; story 7 e2e W7) step over the new
  sidebar Today link. Story 5/6 schema fixtures gained `due_date`/`dueDate: null`. Story 5's migration test lists the
  new `due_date` column. MSW gained a default empty Today handler (the sidebar prefetches Today on hover and focus).
- **Test locations.** As in stories 5–7: shared-schema and `splitToday` unit tests in `apps/api/test/unit`; the date
  logic runs in `apps/web/test/unit/dates` (Node, where `TZ` can be set per file; workerd cannot change zones);
  UI tests in `apps/web/test/ui/{dates,today}` with a stateful MSW Today server; TC-114 has its own file because the
  panel module must be unloaded and its import mocked.
- **Local dev server.** `wrangler dev` keeps its asset manifest from start-up: after a `vite build` it served
  `index.html` for the new chunk names, which broke the app and showed up as unrelated e2e failures (WebKit WF-1's
  "socket closed" console error, then timeouts). Restart `wrangler dev` after rebuilding before running e2e.
- **Story 8 verification.** Everything below passes:
  - typecheck (all five tsconfigs), lint and build;
  - unit: api 200, deploy 50, web 356;
  - integration: api 335 (with the staging and production simulations), deploy 18;
  - UI: 319;
  - e2e: 121 passed and 35 skipped (desktop specs of stories 4, 6, 7 and 8 on WebKit) across chromium, webkit and
    mobile-touch, then the `perf` project (2 passed; TC-94 also 3 times in a row).

  As before, `bun run <script>` cannot run in this sandbox (`CouldntReadCurrentDirectory`), so each script's underlying
  binary was run directly against a freshly started `wrangler dev` with a fresh `vite build`.
