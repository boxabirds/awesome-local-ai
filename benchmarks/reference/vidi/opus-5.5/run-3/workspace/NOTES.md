# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec left room:

- **Where `useCamera` lives.** The design gives `BoardViewport` only a `children` prop but also wants the
  viewport to measure its own size (ResizeObserver) and the zoom controls to stop wheel propagation into the
  board (TC-30). So `BoardViewport` calls `useCamera` itself and renders `ZoomControls` and `NavigationHint`
  as fixed overlays inside it. `App.tsx` just mounts `<BoardViewport />`. The controls and hint still take
  exactly the props in the design.
- **Stopping wheel propagation over the controls.** React's synthetic `onWheel` runs after the board's native
  listener, so `ZoomControls` adds its own native `wheel` listener that calls `stopPropagation` (and does not
  call `preventDefault`, so the browser default is kept there, per TC-30).
- **Initial view.** The board opens in the same view as Reset view: 100% with the origin centred.
- **Batching.** Continuous input (drag, wheel, Safari gesture) is rendered at most once per animation frame.
  Discrete actions (buttons, shortcuts, reset) render right away so the label updates as soon as the click
  happens.
- **Extra `useCamera` members.** Besides the contract, `useCamera` returns `zoomBy(point, factor)` (Safari
  gestures) and `setCamera(cam)` (only used by the test hook; it does not dismiss the hint).
- **Test hook.** `window.__vidi6.{setCamera,getCamera}` exists only when `import.meta.env.MODE === 'test'`
  (Vitest, and `vite build --mode test`, which `npm run test:e2e` runs before Playwright). `npm run build`
  (production) does not include it — checked by grepping the bundle.
- **Grid dots** sit on world multiples of `GRID_SPACING_WORLD`, so the origin marker is on a dot. Dots fade
  once their on-screen spacing drops below `GRID_FADE_BELOW_SPACING_PX`, so a zoomed-out grid does not turn
  into a grey wash. Wheel line-mode deltas use `WHEEL_LINE_HEIGHT_PX`. Both are new settings in
  `src/shared/config.ts`.
- **Shortcuts.** Ctrl/Cmd with `=`/`+`/NumpadAdd zooms in, `-`/`_`/NumpadSubtract zooms out, `0`/Numpad0
  resets. They are handled on `window` (as the design says), but ignored when focus is in a text field, so
  later stories that add text inputs aren't affected.
- **Pan buttons.** Primary- and middle-button drags on empty board space pan.
- **Firefox in Playwright.** Firefox's own macOS sandbox can't start when the test runner is itself sandboxed,
  so the Playwright Firefox project turns it off with the `MOZ_DISABLE_*_SANDBOX` env vars and
  `security.sandbox.content.level = 0`. This only affects the test browser.
- **Red phase.** Task 1 asks for a separate commit of the failing unit tests. The instructions for this build
  ask for one commit per story, so the red phase (every test failing with "not implemented") was run but not
  committed on its own.
- **Manual checks not done here.** Real trackpad pinch in Safari, and smoothness / frame rate, are manual
  checks (design "Not covered"). The Safari gesture handler is covered by component test TC-17.

## Story 2 — Capture ideas on sticky notes and rearrange them

Decisions made where the spec left room:

- **How the board and the notes connect.** `BoardViewport` still owns the camera. It now takes `children` as a
  render function `({ camera, size }) => …` (the notes need the zoom), an `overlay` render function for fixed
  screen-space UI (the left `Toolbar`, which needs the viewport centre), and two callbacks:
  `onDoubleClickEmpty(worldPoint)` and `onEmptyClick()`. `App` calls the board model from those callbacks, so
  `BoardViewport` stays independent of the document.
- **Stacking without moving DOM nodes.** Notes are rendered in a fixed DOM order (by id) and stacked with
  `z-index` = their rank in the `(z, id)` order from `snapshot()`. The first version re-ordered DOM nodes. That
  broke dragging: when `bringToFront` moved the dragged note's node, the browser dropped pointer capture and the
  drag ended. One side effect is that Tab visits notes in id order, not stacking order.
- **Note toolbar placement.** `StickyNote` renders `NoteToolbar` (as in the structure diagram) through a portal
  into an overlay layer at the end of the world layer (`WorldOverlayContext`). That way it is drawn above every
  note. It is positioned at the note's top-centre in world units and scaled by `1 / zoom`, so it keeps its screen
  size. With no overlay (a note rendered on its own), it renders inline.
- **Ending editing.** While editing, `StickyTextEditor` listens for `pointerdown` on the document in the
  capture phase. A press outside the note calls `onEnd('unselected')` before the board, another note or a button
  handles it. Pressing another note therefore ends editing and selects that note. Blur only flushes pending
  text; it does not end editing, so switching windows doesn't close the editor.
- **Enter to edit** calls `preventDefault`, so that same Enter isn't typed as a newline into the editor it opens.
  It is ignored when focus is on a button or link, where Enter already means "activate".
- **Keyboard focus.** Notes have `tabIndex=0`. When a note gets keyboard focus (Tab), it is selected, so Enter
  and Delete work on it. A pointer press still selects on release, as the state diagram says. After Escape, focus
  goes back to the note.
- **Text limit when typing in the middle.** `clampToLimit` is the plain cut from the contract. The editor uses
  `limitEdit(prev, next)`, which cuts only the newly inserted characters. So typing into a full note drops the
  typed character and does not remove the end of the note. The caret goes to the end of the kept insertion.
  Neither function splits an emoji's surrogate pair.
- **Invalid input to the model.** `createSticky` with non-finite coordinates returns `''` and writes nothing
  (the contract returns `string` and says never throw). `moveObject` to the note's current position and
  `setStickyColor` to its current colour are no-ops: they return `false` and emit no update. `bringToFront`
  also lifts a note that only ties the highest z.
- **Snapshot identity.** `useBoardDoc` keeps unchanged notes, and the whole list when nothing changed,
  reference-equal between snapshots. `StickyNote` is memoised, so a drag re-renders only the dragged note
  (relevant to the 500-note constraint). The `objects` observer is attached only while React is subscribed.
- **Vertical centring.** Display text is centred vertically with auto margins, so overflow goes only downward
  and `scrollHeight` measures it. The textarea gets a matching `paddingTop` (from the measured text height), so
  the text doesn't jump when editing starts.
- **New named settings** in `config.ts`, besides the ones in the design: `STICKY_PADDING_WORLD` (16) and
  `STICKY_LINE_HEIGHT` (1.25).
- **Test hooks.** `installTestHooks` now merges parts into `window.__vidi6`. `App` adds `notes()` (the current
  snapshot), which the e2e tests use to read world positions. As before, test builds only.
- **Component tests** render the whole `App` on a real `Y.Doc` passed in with `<App doc={doc} />`. They fake
  only animation frames, because Testing Library's async helpers (user-event) need a real `setTimeout`.
- **Red phase.** Tasks 1 and 3 ask for separate commits of the failing tests. As in story 1, the red phase
  was run (every test failed with "not implemented") but not committed separately, because this build uses one
  commit per story.
- **Manual checks not done here.** IME input on a real keyboard (the composition guard is covered by a
  component test) and the 500-note performance run are manual, as the design's "Not covered" section says.

## Story 3 — See other people's edits appear live on the same board

Decisions made where the spec left room:

- **Vitest 4.1 instead of 5.** `@cloudflare/vitest-pool-workers` (0.22, the newest) supports only `vitest ^4.1`; with
  vitest 5 its runner fails to start inside workerd. Vitest was moved to 4.1.11 for the whole repo. All earlier unit
  and component tests pass unchanged.
- **Integration tests** have their own config, `vitest.integration.config.ts` (`npm run test:integration`), because
  the Workers pool takes over the whole project. The script builds the client first, because TC-06 reads
  `index.html` from the assets. The pool's own workerd is a few days older than wrangler's, so the test config sets
  `compatibilityDate: '2026-08-22'` and `nodejs_compat` (the test runner needs it). This affects only the tests,
  not `wrangler.jsonc`.
- **Type checking.** The Worker, the Durable Object and the integration tests use Workers runtime types, not the DOM,
  so they have their own `tsconfig.worker.json`. `npm run typecheck` runs both configs.
- **Binary frames.** At our compatibility date, workerd delivers binary WebSocket frames as `Blob`. So the room and
  the test client set `binaryType = 'arraybuffer'`.
- **Rejected updates.** `y-protocols`' `readSyncMessage` logs and swallows an update that Yjs rejects. The room
  therefore reads sync messages itself (`BoardRoom.readSync`, same behaviour otherwise), so an invalid update closes
  the sender with 1003, as the design says.
- **`run_worker_first: ["/api/*"]`** in `wrangler.jsonc`: only `/api/*` reaches the Worker. Other paths are served
  straight from the assets (SPA fallback), and the Worker also falls back to `env.ASSETS` for anything else.
- **Routing.** Any path that isn't a valid `/b/:boardId` (including `/`) is replaced (`history.replaceState`) with
  `/b/<newBoardId()>`. `Root` mounts `App` keyed by the board id, so each board gets a fresh `Y.Doc` and provider.
  `App` still accepts a `doc` (tests) and an optional `boardId`. Without a `boardId` it is offline and the badge is
  hidden.
- **Badge accessible name.** The zoom label is an `<output>`, which also has the `status` role. So the badge has
  `aria-label="Connection status"`, and tests find it with `getByRole('status', { name: 'Connection status' })`. It
  never intercepts pointer input.
- **State mapping** lives in `trackConnectionState(provider, onState)`, exported from `connectBoard.ts` so the
  component tests can drive it with a fake provider. A connection that fails before the first sync stays
  "Connecting…" (PRD alternate flow). Only a loss after having been connected shows "Reconnecting…".
- **Browser offline/online events.** When the browser reports `offline`, `connectBoard` closes the socket, so the
  badge shows "Reconnecting…" right away. Otherwise that would only happen after y-websocket's 30 s no-message
  timeout. On `online` it reconnects at once instead of waiting out the backoff.
- **Caret under remote typing.** When someone else's change arrives while I'm typing, the editor moves my caret
  with the Yjs delta (`transformIndex` in `StickyText.ts`). My caret stays next to my own text, so simultaneous
  typing never interleaves mid-word. Known gap: a remote change that arrives during an IME composition is written
  over by the diff when the composition ends. This is rare, and it is covered properly by moving to a Yjs-bound
  editor later.
- **Delete during edit/drag** needed no new state: `App` already drops a selected or edited id that is no longer in
  the snapshot. A deleted note's `StickyNote` unmounts, which cancels its drag. `moveObject` on a missing id is a
  no-op, so nothing comes back.
- **Nightly tests** live in `tests/e2e/nightly/` and run only in the `nightly` Playwright project
  (`npm run test:e2e:nightly`). `npm run test:e2e` runs the chromium/firefox/webkit projects, which ignore that
  folder. TC-29 counts `WebSocket` constructions to show there were no reconnect attempts while idle. The teardown
  point (`destroy()` on unmount) is covered by the component test, which checks `destroy` runs exactly once on
  unmount. Measured on this machine (TC-30): p50 17 ms, p95 40 ms, max 88 ms over ~5,500 deliveries.
- **E2E latency** is measured from the test runner (poll every 10 ms, timeout `LIVE_UPDATE_LATENCY_BUDGET_MS`), so it
  is an upper bound on the real delay.
- **Browser-specific skips.** TC-27 (outage) is skipped on WebKit, because Playwright's WebKit offline emulation does
  not block WebSockets. The drag variant of TC-25 is skipped on Firefox, because Playwright Firefox stalls input to
  one window while another window holds a mouse button down. Both run on Chromium (and TC-27 on Firefox). TC-22 and
  TC-23 run on all three browsers.
- **Dev server.** `npm run dev` proxies `/api` (including WebSockets) to `wrangler dev` on port 8787. `npm run
  preview` (wrangler dev) serves everything by itself.

## Story 4 — Return to a board and find everything as it was left

Decisions made where the spec left room:

- **`BoardStore` takes a structural storage type.** The constructor accepts `BoardStorage` (`sql.exec` and
  `transactionSync`), which a real `DurableObjectStorage` satisfies. The unit tests import `chunkBytes` /
  `shouldCompact` from `board-store.ts` under the DOM tsconfig, where the Workers `DurableObjectStorage` type
  does not exist. It also lets TC-11 and TC-26 wrap real storage to inject failures. `compact(doc)` (unconditional)
  is exported next to `compactIfNeeded(doc)` for the tests and the seed hook.
- **Per-row size limit.** SQLite-backed Durable Objects currently allow 2 MB per row/BLOB. `SNAPSHOT_CHUNK_BYTES`
  (512 KiB) stays well under that. Our 2,000-note fixture encodes to ~574 KB, i.e. two chunks.
- **Validation before apply.** Both the room and the loader run `Y.decodeUpdate` before `Y.applyUpdate`, so
  malformed bytes throw before touching the doc.
- **One damaged log row (persist.partial_damage).** Yjs updates from one client form an unbroken clock sequence,
  so quarantining a single row would leave every *later* change by the same client pending forever. That would lose
  far more than one change. After quarantining, the loader fills each resulting clock gap with a GC placeholder
  struct (what Yjs itself uses for garbage-collected content): later changes integrate, and only content that was
  built directly on the lost change is dropped. TC-09 checks all 25 notes survive and at most one differs.
- **Room lifecycle.** `room-state.ts` holds the pure `nextRoomState` (TC-27). `BoardRoom` drives it. Its
  `state` getter exposes the design's `RoomState` (`ready | load-failed | storage-failed`). Compaction is
  synchronous, so `compacting` is never observable from outside.
- **Load-failed rooms** accept the socket and close it at once with 4500, so the browser gets the code, not a
  failed upgrade. A socket still open when a room ends up load-failed is closed with 4500 on its next message.
  `LOAD_RETRY_MIN_INTERVAL_MS` is enforced from the time of the last failed load.
- **Restarts in integration tests** use `state.abort()`: the next request constructs a new instance over the
  same storage. TC-18 (hibernation) constructs a second `BoardRoom` over the same `DurableObjectState` and
  calls its `webSocketMessage` with a socket accepted by the first instance. TC-16 moves `loadFailedAt` back by
  the interval instead of sleeping 5 s.
- **Test hooks.** `src/worker/test-hooks.ts` adds `POST /__test/boards/:id/{seed,compact,corrupt-snapshot,repair}`.
  These routes work only when `env.TEST_HOOKS === '1'`. The e2e servers pass `--var TEST_HOOKS:1` on the
  `wrangler dev` command line, so `wrangler.jsonc` never sets it. `/__test/*` was added to `run_worker_first`.
  Without the variable the Worker hands these paths to the static assets (an integration test checks this). `seed`
  (apply an update and compact) lets TC-21 and TC-24 start from a saved, snapshotted board without typing 2,000
  notes. `corrupt-snapshot` also reloads the room at once, as a restart would.
- **E2E process control.** `tests/e2e/persistence.spec.ts` runs in its own `persistence` Playwright project
  (chromium, included in `npm run test:e2e`). The other projects ignore it. Each test starts its own
  `wrangler dev --persist-to <tmp>` through `tests/e2e/helpers/wrangler-process.ts` on a per-worker port and kills
  it with SIGKILL on the whole process group. Playwright's shared `webServer` still starts, but these tests
  don't use it. TC-19 has a second person watch the board before everyone leaves, so every change was
  confirmed by the server (PRD `persist.seen_is_saved`).
- **Large boards (persist.large_board).** The first TC-21 run took ~4.9 s. The server synced in ~130 ms. The
  rest went to font fitting: every note's measure forced a layout of the whole board, which is O(n²). Each note is
  now its own layout boundary (`contain: size layout style` on `.sticky-note`; notes have a fixed size, and paint
  is not contained so the selection outline still shows). The same board now renders in ~600 ms locally.
- **Edit lock.** `canEdit(state)` (exported from `App.tsx`) is false only for `load_failed`. While it is false,
  the Sticky note button is disabled, double-click create, Delete/Backspace and Enter are ignored,
  `StickyNote` does not start drags, edits or show its colour/delete toolbar, and an open editor is closed.
  Selection still works; it changes nothing.
- **Close-code mapping.** `connection-close` 4500 → `load_failed`. The `disconnected` status that follows does
  not override it, and retries that fail again keep it. Any other close code while `load_failed` → `reconnecting`
  (or `connecting` if never synced). The first successful sync → `connected`. y-websocket treats only
  4400–4499 as terminal, so it keeps retrying on 4500 with the story 3 backoff.
- **Badge colour.** Red variant `connection-status--load_failed` (text `#a4161a` on `#fde2e1`). The text is
  the PRD's exact string, with a straight apostrophe.
- **Not covered here** (as the design says): output-gate ordering under real disk latency, production
  eviction/hibernation timing, and load time over real internet latency. TC-21 timing is local.
- **Nightly soak.** `npm run test:e2e:nightly` passed twice in a row (TC-30 p95 45–46 ms, max ≤ 116 ms). A run
  before those timed out once in TC-30 inside a mouse click. It did not happen again and was not diagnosed further.

## Story 5 — Share a board with others using a link

Decisions made where the spec left room:

- **Rate limiter.** `BOARD_CREATE_LIMITER` is a real `ratelimits` binding (namespace id `1001`, limit 10, period 60).
  The local runtime (miniflare, in both `wrangler dev` and the Workers test pool) simulates it, so TC-13 and TC-30
  use the real binding, not a fake. Its local windows are fixed and aligned to the clock, so those two tests first
  wait until enough of the current window is left. The visitor key is `CF-Connecting-IP` (`'unknown'` if it is
  missing). Local `wrangler dev` keeps a `CF-Connecting-IP` header the request already has. The e2e tests use this
  to give each test its own made-up visitor address, so parallel tests (and browsers) never use up each other's limit.
- **Existing tests now create their boards first.** Unknown boards are 404 now, so story 3/4 tests that joined a
  random id create it first. Integration tests call `initialize()` over RPC (`createdBoardId()` in `ws-client.ts`).
  E2E tests call `POST /api/boards` with a random visitor (`tests/e2e/helpers/boards-api.ts`). Story 3's TC-04 now
  expects 404 instead of 400 for malformed ids (the design changes this). The persistence spec's "empty spot"
  moved from (1200, 40) to (1200, 120), because the new Share button sits in the top-right corner.
- **`initialize()` never re-creates a board.** It returns `'exists'`, without writing, when the board already exists
  by the existence rule, legacy boards included. So a legacy board is never handed out as a new board either.
  `created_at` is written in the same transaction as the tables.
- **Storage reads for unknown boards.** `BoardStore.load()` returns an empty board when the tables are missing and
  does not create them. `append()` runs `migrate()` lazily. So an existence check, a rejected WebSocket, or the
  constructor's load for an unknown id leaves `sqlite_master` empty (TC-06, TC-09). A room whose storage can't
  even be read for the existence check does not answer 404. It accepts the connection and closes it with 4500, as
  in story 4, so "can't read" is never shown as "doesn't exist".
- **Test seams.** `createBoard(env, visitorKey, generate = newBoardId)` and `handleRequest(req, env, { generateId })`
  let integration tests force id collisions (TC-11). The default export always uses `newBoardId()`. `createBoard`
  takes a structural env type, because the unit tests (DOM tsconfig) import `create-board.ts`.
- **HTTP details.** `GET`/`HEAD` on `/api/boards/:id`, and anything but `POST` on `/api/boards`, get `405` with an
  `Allow` header. API responses are `Cache-Control: no-store`. The client treats any status other than 200/404 on
  the check as unreachable and retries, as the design says.
- **Test hook for legacy boards.** `POST /__test/boards/:id/seed-legacy` (only with `TEST_HOOKS=1`) stores an update
  as log rows without `created_at`: a board saved before this story (TC-31).
- **Router and pages.** `useRoute()` uses `useSyncExternalStore` over `popstate` and a custom navigate event.
  `/b/:id` always routes to `BoardPage`, which shows Board not found for malformed ids without sending a request.
  `Root` keys `BoardPage` by id. The Board not found page also has a "Go to the home page" link (the PRD asks for
  a link back home but gives no wording).
  The create button's error message sits in a `role="alert"` paragraph under the button. Both pages share it.
- **Share panel.** Opening the panel focuses the link field, which selects the whole link. Escape (or clicking Share
  again) closes the panel and returns focus to the Share button. A press outside closes it *without* moving focus.
  Pulling focus back to Share there would take it away from what was clicked: the first e2e run showed a
  double-click on the board losing its new note editor that way. The tick in "✓ Link copied" is `aria-hidden`, so the
  button's name is exactly "Link copied".
- **Browser coverage.** TC-26 (real clipboard) runs only in Chromium, because only Chromium can grant clipboard read
  in Playwright. TC-28 and TC-30 test server/request behaviour and run once, in Chromium. TC-27 and TC-29 run in all
  three browsers.
- **Nightly soak fix.** `npm run test:e2e:nightly` failed twice in TC-30, both times timing out on a click.
  The logged call showed the cause: the colour toolbar of a note near the top edge was outside the viewport.
  The soak only required a note's centre to be 60 px below the top, but at 50% zoom the note plus its toolbar
  reach about 100 px above the centre. The random seed decides whether a note ends up there, so the story 4
  one-off timeout was probably the same thing. The guard now requires 120 px, which also keeps clicks clear of
  the new Share button. With the failing seed (`VIDI6_SEED=120660`) the soak passes (p95 45 ms).
