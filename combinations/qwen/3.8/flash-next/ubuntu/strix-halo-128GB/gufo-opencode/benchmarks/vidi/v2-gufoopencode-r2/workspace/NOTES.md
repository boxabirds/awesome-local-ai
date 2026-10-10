# Notes for story 1

## Deviations from design / spec

- ZoomControls and NavigationHint are rendered inside BoardViewport (in a
  pointer-events:none overlay) rather than wired up in App.tsx. BoardViewport's
  component contract accepts only `children` and owns the camera state, so
  keeping the controls inside it is the only way to pass live camera props.
  App.tsx simply renders <BoardViewport />.
- CameraApi was extended with `zoomBy(factor, point)` (beyond the design's
  contract) to serve the Safari gesturechange pinch handler.
- wrangler was raised to v4 (assets-only Workers config, `send_metrics: false`)
  and vitest to v3 (projects support) - the versions initially pinned failed
  config validation / feature checks.
- @playwright/test is pinned to 1.63.0: it is the newest release whose browser
  revisions match the pre-cached build set of this machine.
- TC-25 e2e: Playwright's isDisabled()/click() loop raced the rAF-batched
  disable update (a click on the freshly disabled button hangs on actionability
  until timeout). Replaced with exactly seven deterministic + clicks
  (1.25^6 < 4 <= 1.25^7), which reaches the clamp with the last click still
  enabled, then asserts 400% and disabled.
- Component tests use vi.useFakeTimers faking only requestAnimationFrame /
  cancelAnimationFrame and flush inside act(), because camera commits are
  coalesced to one render per animation frame. A ResizeObserver mock delivers
  a fixed 1280x800 viewport synchronously (jsdom has none).

## Blocked (not runnable on this machine)

- Task 7, Firefox and WebKit e2e: the browser builds themselves are installed,
  but the host is missing system libraries they link against - Firefox needs
  libgtk-3.so.0; WebKit (WPE) needs libWPEWebKit-2.0, GTK4, libGLESv2 and
  libgstallocators/gstapp/gstpbutils/gstaudio/gsttag/gstvideo/gstgl/
  libbacktrace. They cannot be installed: sudo is blocked ("no new privileges")
  and every Ubuntu mirror (archive.ubuntu.com and alternates) is network-blocked.
  The Firefox/WebKit test cases therefore could not be executed here.
- Task 7, Chromium e2e: the navigation suite (TC-23..TC-28, TC-31) passed 7/7
  in Chromium during development (Playwright 1.64 + cached chromium-1248).
  Afterward `npx playwright install` deleted the pre-cached browser set from
  /w/browsers. The chromium-for-testing downloads are unavailable from this
  sandbox: cdn.playwright.dev returns 403 and its 307 redirect target is
  network-blocked, the prss.microsoft.com mirror returns 400 for cft/legacy
  builds, storage.googleapis.com and npmmirror are blocked, and the binaries
  are not on npm. The intact original builds (chromium-1243/1248 plus headless
  shells) still exist at ~/.cache/vidi-agent-ms-playwright, but that
  path is denied to this tool environment. The e2e code itself is complete and
  committed under tests/e2e/.

## Verified on this machine

- npm run typecheck: clean.
- npm run build: clean; window.__vidi6 test hook confirmed absent from the
  production bundle (dead-code eliminated).
- npm run test:unit: 13/13. npm run test:component: 15/15.
- npx playwright test --project=chromium: 7/7 (see Chromium note above for the
  build-loss afterward).

# Notes for story 2

## Resolved since story 1

- Chromium e2e IS runnable here: the intact cached builds under
  ~/.cache/vidi-agent-ms-playwright turned out to be readable from
  this session. Running e2e with
  `PLAYWRIGHT_BROWSERS_PATH=~/.cache/vidi-agent-ms-playwright
  npx playwright test --project=chromium` works (12/12). The Firefox/WebKit
  system-library blockage above still stands.

## Deviations from design / spec

- createSticky returns `string | false` (the design contract said `string`) so
  TC-39 can reject non-finite coordinates with zero Y.Doc updates instead of
  throwing.
- BoardViewport gained three optional props (onCreateStickyAtWorld,
  onClearSelection, onViewportHandle with a ViewportHandle camera accessor) so
  App can resolve screen-space interactions (double-click point, Sticky note
  button centre, constant-size note toolbar) that the component contract did
  not anticipate; without them the world->screen math would have to leak.
- Notes are rendered in stable createdAt order with CSS `zIndex: note.z`
  instead of re-sorted children. React moves keyed children via remove +
  insertBefore, which detaches the dragged node, silently kills pointer
  capture, and froze drags the moment bringToFront fired mid-drag (found by
  TC-31/32). z-order semantics (snapshot still sorted by z; bringToFront
  unchanged) are untouched.
- The note toolbar is counter-scaled in CSS
  (translateX(-50%) scale(1/var(--note-zoom))) instead of being rendered in a
  separate screen-space layer, keeping it a child of the note it belongs to.
- e2e helpers: setCamera now polls data-camera until the rAF-coalesced camera
  commit has rendered before returning, otherwise the next mouse action (e.g.
  double-click create) would run in handlers closed over the previous camera
  (caused flaky TC-31/32 placement).

## Verified on this machine

- npm run typecheck: clean.
- npm run build: clean; window.__vidi6 absent from the production bundle
  (grep count 0); present in build:test.
- npm run test:unit: 41/41. npm run test:component: 33/33.
- npx playwright test --project=chromium: 12/12 (7 story 1 + 5 story 2).

## Story 3 notes

- `@cloudflare/vitest-pool-workers` pinned to ^0.12 (needs vitest ^2–^3; 0.13+ requires vitest 4).
- Typecheck split: `src/worker` + `tests/integration` compile under `tsconfig.worker.json`
  (`@cloudflare/workers-types`), everything else under the DOM-based `tsconfig.json`.
  `npm run typecheck` runs both.
- `vitest.config.ts` keeps one file with three projects; the workers pool is unknown to plain
  vitest types, so the integration project is a plain object cast to `UserWorkspaceConfig`
  (pool: `'workers'`).
- BoardRoom relays awareness bytes verbatim to every socket including the sender (per design;
  keeps idle y-websocket clients alive). Y-protocols ignores same-clock awareness updates, so
  this does not loop.
- lib0's `Decoder` exposes `.arr` (not `.buf`); `decodeMessage` bounds-checks every varuint
  against `arr.length` because lib0 reads past-the-end bytes as 0 instead of failing.
- Yjs `encodeStateVector` of a fresh doc is never empty (1 byte), so a hand-crafted
  `[0,0,0]` sync frame with a truly empty state vector is rejected by the room with
  `CLOSE_UNSUPPORTED_DATA` — that path is exercised by TC-15, not a bug.
- Vitest projects (single config file) cannot host the workers pool: `pool: 'workers'` is then
  resolved as a custom-pool file path. The integration suite therefore lives in its own
  `vitest.integration.config.ts` (`defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`).
- `isolatedStorage: false` in the integration pool options: BoardRoom keeps nothing in DO storage
  (story 4 will add it), and the per-test storage snapshot/restore breaks with the long-lived
  WebSocket handles the room holds ("Isolated storage failed" on suite teardown).
- workerd test-side sockets (`SELF.fetch` upgrade + `accept()`): a self-initiated `close()` never
  delivers a `close` event and the socket stays CLOSING (never CLOSED); only room-initiated closes
  fire events. Tests poll `readyState !== OPEN` for self-closes and `close` events for room closes.
- `y-protocols` `readSyncMessage` swallows Yjs update-application errors internally
  (`readSyncStep2`/`readUpdate` try/catch). The BoardRoom passes an errorHandler that rethrows,
  so a malformed update closes only the offending socket (TC-15 run 4).
- Test names with non-ASCII characters trip a miniflare "non-ASCII header value" warning (the
  test title rides in an internal header). Integration test names stay ASCII.
- `StickyTextEditor` originally never observed its `Y.Text` for remote changes: while editing,
  every input flushed `applyTextDiff(ytext, textarea.value)` against a stale local value, so a
  concurrent editor's characters were treated as deletions (last-writer-wins). Fixed by mirroring
  remote transactions into the textarea with caret kept at a fixed distance from the text end.
  Unit/component tests could not catch this (single writer); TC-23 e2e did.
- Playwright `context.setOffline(true)` does NOT drop established WebSocket connections
  (probe: badge state unchanged for 25s of "offline"). y-websocket only notices via its 30s
  silence timeout (`messageReconnectTimeout`, check tick every 3s), so an offline badge appears
  ~33s after `setOffline`; reconnect lands <1s after going back online. TC-27 timeouts account
  for this. Badge text history is captured with an in-page MutationObserver because the
  Connected badge hides after CONNECTED_CONFIRMATION_MS and polling can miss the window.
- Firefox/WebKit cannot launch here (missing GTK/WPE system libs), so `playwright.config.ts`
  includes those projects only with `E2E_ALL_BROWSERS=1`; default `npm run test:e2e` runs
  chromium, per the "Chromium is sufficient if other browsers are not installed" rule.
  TC-22/TC-23 on firefox/webkit (tasks.md 8 Done-when) is therefore environment-blocked.
- Nightly soak: Playwright actions have no default timeout, so one click waiting on a
  never-visible toolbar hung TC-30 to the 10-minute test timeout; nightly config now sets
  `actionTimeout: 4000` and the soak skips conflicted actions. `E2E_SOAK_MS` overrides the
  60s soak for quick smoke runs. Last full nightly: ~1300 change deliveries, p50 6ms
  p95 11ms (budget 1000ms, reported not asserted).
- `reuseExistingServer` skips the webServer command, so a reused wrangler serves whatever build
  `dist/client` holds: a later `npm run build` (production) silently removes the `__vidi6` test
  hooks and e2e fails with "missing-hook". Both e2e pretest scripts now run `build:test`, and
  orphan wrangler processes must be killed when a backgrounded run gets interrupted.

## Story 4 notes

- Room lifecycle is a pure state machine (`src/worker/room-state.ts`, TC-27):
  loading / ready / compacting / hibernated / load-failed / storage-failed.
  BoardRoom keeps the current state and routes through `nextRoomState`.
- `runInDurableObject` calls the callback as `(instance, state)` only and runs
  it in the same isolate, so fault injection in integration tests monkey-
  patches the live instance (e.g. wrap `store.append`, patch
  `BoardStore.prototype.load`) through `runInDurableObject(boardId, (obj) => …)`.
- Damaging a row INSIDE the update log is nearly invisible in Yjs: clock
  chaining makes every later update defer silently, so a corrupt interior row
  yields a loadable-but-truncated board. TC-09/09b therefore damage the LAST
  log row (or chunk 0 after compaction) to hit the load-failure path.
- Fixture gotcha: `initDoc` in tests/fixtures must run AFTER `startCapture`,
  and text inserts need `doc.transact(fn, LOCAL_ORIGIN)` — otherwise the
  captured byte sequence no longer reproduces the doc state.
- Compaction thresholds are only exercised by named settings
  (COMPACTION_UPDATE_COUNT/COMPACTION_BYTES); the test hook calls
  `compact(doc)` directly so corruption deterministically hits chunk 0.
- BLOB round-trip in workerd DO SQLite returns `ArrayBuffer` (not Uint8Array);
  BoardStore normalizes with `new Uint8Array(...)`.
- Hibernation: `ctx.acceptWebSocket(server, ['vidi6-board'])`, broadcast via
  `ctx.getWebSockets('vidi6-board')`; constructor loads the board inside
  `ctx.blockConcurrencyWhile` so the first joiner never sees a half-loaded doc.
- Client maps close codes in the y-websocket status mapper: 4500 ->
  `load_failed` (sticky; status events cannot downgrade it), 1000/1001/1005
  ignored, all others -> `reconnecting`; the first `sync` after `load_failed`
  returns to `connected` in place (TC-28, no reload).
- The zoom control also uses `role="status"`, so component/e2e selectors pin
  the badge by `.connection-status` / `.connection-status--load_failed`.
- `canEdit(state)` (exported from App.tsx) is false only for `load_failed`; it
  disables the toolbar, gates keyboard create/delete, double-click create and
  StickyNote dragging/editing via a single `editable` prop.
- Test hooks (`src/worker/test-hooks.ts`): POST
  `/__test/boards/:id/corrupt-snapshot` and `/repair` are registered ONLY when
  `env.TEST_HOOKS === '1'` (wrangler `--var`, e2e configs only). Without it the
  paths fall through to the SPA handler — verified in TC-24 step 4 against a
  `TEST_HOOKS:0` worker sharing the same `--persist-to` directory (board
  intact, hook answered SPA/405, never hook JSON).
- Persistence e2e (`tests/e2e/helpers/wrangler-process.ts`) spawns real
  `wrangler dev --persist-to <tmpdir>` processes on 29434-29437 (config
  `playwright.persistence.config.ts`, workers:1, no webServer) so restarts
  really restart the isolate. TC-21 (2000 notes) is REPORTED, not asserted:
  measured ~3.8s render vs the 3000ms BOARD_LOAD_BUDGET_MS — the budget is
  exceeded on this machine and the spec says report only.
- The load-failure badge e2e recovery (TC-24) rides y-websocket's own
  reconnect backoff; after the repair hook flips the room back to `ready`,
  the next reconnect lands within seconds and editing re-enables with no
  reload.

### Verified on this machine (story 4)

- npm run typecheck: clean (both tsconfigs).
- npm run build: clean; `__vidi6` test hooks absent from the production
  bundle (grep count 0).
- unit + component: 121/121. integration (workers pool): 41/41.
- npm run test:e2e (chromium, stories 1-3): 19/19.
- npm run test:e2e:persistence: 4/4 (TC-19, TC-20, TC-21, TC-24). TC-21
  measurement: 2000 notes synced 3695ms, fully rendered 3702ms — OVER the
  3000ms BOARD_LOAD_BUDGET_MS on this machine; reported only per spec.
- npm run test:e2e:nightly (E2E_SOAK_MS=10000): 2/2, including the full 45s
  idle-stability test — idle hibernation does not drop established clients.

## Story 5 notes

### Deviations from design / spec

- `nextBoardPageState` takes a 4th parameter (`boardId`) beyond the design's
  three. `CheckResponse` for a `ready` board carries no id (the id is already
  in the URL), but the `board` state must remember which board to render, so
  BoardPage passes the id it checked into the transition function.
- SharePanel lives in `src/client/share/SharePanel.tsx`, not
  `src/client/pages/share/`. It is a cross-cutting panel (the page files stay
  the route-level screens), and the design's directory listing only pinned
  component behavior, not its path.
- `BoardRoom` no longer migrates at construction. `migrate()` runs on the
  `initialize()` RPC and lazily before the first `append()`; `load()` and the
  existence probe consult `sqlite_master` and treat missing tables as an
  empty, non-existent board. Without this a `GET /api/boards/:id` probe would
  create tables for unknown ids (and thus "create" boards by looking at
  them). `ensureCreatedAt()` stamps `created_at` exactly once; legacy boards
  (rows but no `created_at`) still exist via `existsReadOnly()`.
- Test-hook plumbing: `maybeHandleTestHook` forwarded header-less,
  body-less requests (fine for the story-4 hooks). The new `seed-legacy`
  hook carries JSON, so the forwarder now buffers and pipes the POST body.
- The default e2e webServer command adds `--var TEST_HOOKS:1` so
  `tests/e2e/share.spec.ts` TC-31 can seed a legacy board through the hook
  (same pattern the persistence suite already uses through
  `WranglerProcess`). Persistence TC-24 keeps asserting hooks are absent
  without the flag.
- E2E clipboard assertion uses an in-page wrapper around the real
  `navigator.clipboard.writeText` that records the copied text and still
  calls through. Chromium gates `readText()` behind document-activation
  rules that do not survive the automated click reliably; the recorder keeps
  the real write path exercised while the assertion reads what was handed
  to the clipboard. TC-29 overrides `writeText` to reject to drive the
  manual-copy fallback.
- `gotoBoard()` now waits for the `connected` connection state after the
  viewport appears. BoardScreen mounts as soon as the existence check says
  ready, so the viewport can appear mid-sync, and the finishing board load
  re-centers the camera - that raced `setCamera` in sticky TC-30..TC-32 once
  navigation went through `/b/:id`.
- E2E helpers/persistence specs open boards by first calling
  `POST /api/boards` via `page.request` (`createBoardApi`), because
  connecting no longer creates a board.

### Verified on this machine (story 5)

- `npm run typecheck` clean; `npm run build` (production) succeeds.
- Unit: 84 tests / 8 files pass (incl. TC-04 board-id format + uniqueness).
- Component: 49 tests / 10 files pass (existing 28 story 1-4 tests unchanged,
  plus TC-16, TC-17, TC-19..TC-25).
- Integration (workerd): 51 tests / 5 files pass, incl. board-api suites for
  TC-05..TC-10, TC-12, TC-14, TC-15, TC-32.
- E2E: 24 tests pass, incl. share.spec TC-26..TC-29, TC-31. TC-26 measured
  click-to-board 201ms (CREATE_BUDGET_MS 2000ms - within; reported, not
  asserted, per the design's timing policy).
- Persistence E2E: 4 tests pass with boards created through the API. TC-21
  2000-note load measured 3783ms (over the 3000ms budget; reported, not
  asserted - unchanged behavior from story 4).
- Nightly: 2 tests pass (capacity soak; idle-stability 45s, no Reconnecting).
