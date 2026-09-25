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

## Story 7 — Select, move, resize and delete several objects at once

Decisions made where the spec left room:

- **Two snapshots.** `snapshot(doc)` still returns only sticky notes (`StickySnapshot`, now with `width`/`height`).
  Story 2–5 code and tests, and the `notes()` test hook, depend on its note fields. The new
  `objectSnapshot(doc)` returns every object of a *known* type as `ObjectSnapshot` (`id, type, x, y, width,
  height, z`). The board renders from it, and the selection, gesture and keys use it.
- **Known types live in board-model too.** `allObjectIds` and `objectsInRect` are in the framework-free
  board-model, but they must skip unregistered types. So board-model keeps a set of known types (`sticky`
  built in), and the client's `registerObjectType` adds each type to it (`registerModelObjectType`). Group
  operations only touch known types. Objects of unknown types are left untouched in the doc.
- **Width/height.** `createSticky` now writes `width`/`height` (200). Notes without them read as
  STICKY_SIZE_WORLD, and the first resize writes both. There is no migration. Font fitting uses the note's
  height as the box. The editor's vertical padding uses the height too.
- **Selection reducer and absent ids.** The pure reducer ignores `click`/`toggle`/`setMany` for ids that are
  not on the board. For that, its state keeps the ids that were present at the last `prune`. `edit` is not
  filtered, because a note created a moment ago (double-click → edit) is not in the last snapshot yet. The hook
  also hides pruned ids during the render before its layout-effect `prune` runs. `endEdit` takes an optional
  `'selected' | 'unselected'`, as story 2's editor needs (a press elsewhere ends editing and deselects).
- **When a press changes the selection.** A press on an unselected object selects it right away (Shift: adds
  it), so a drag moves it. A press on a selected object waits for the release: a click without dragging then
  selects only that object (Shift: removes it), and a drag moves the whole selection. The design says
  "click an object: selects only that object", and this still does that, but it doesn't break up a
  multi-selection the moment a drag starts. The note's focus handler (Tab selects) ignores focus caused by a
  pointer press, so Shift-click can't replace the selection through focus.
- **Gesture events.** `useTransformGesture` follows the pointer with `window` listeners instead of pointer
  capture on the note. That works the same for notes, handles and future types, and a note whose DOM node
  goes away mid-drag (deleted remotely) can't end the gesture early. Moves are written once per animation
  frame. A release writes the final position (story 2's rule, kept by its tests). A cancel keeps the last
  applied frame. The hook also returns `state` (`idle | pressed | moving | resizing`), which the App uses
  for `data-state="pressed|dragging"` and to hide the bars during a gesture.
- **Resize maths.** `handleScale` turns a handle drag into scale factors. With aspect lock, a corner uses the
  axis that moved further, and an edge scales the other axis about the box centre. `clampScale` clamps once
  for the whole group: uniformly when the factors are equal (aspect kept), otherwise per axis. An axis whose
  factor is exactly 1 is left alone, so an edge drag never changes the other axis. `scaleFromHandle` anchors
  the result at the opposite corner or edge. Resizing never flips an object. An object whose type is not
  resizable would keep its size and only move with the group. No such type exists yet.
- **Handles** are 8 `role="button"` elements (`aria-label="Resize top-left"` etc., `tabIndex=-1`, so they
  are not in the tab order). They sit in the screen-space overlay, so they stay HANDLE_SIZE_PX at every zoom,
  with a 4 px invisible hit margin. They show for any selection, including a single note. They are hidden
  while text is edited, during a group move, and when the board can't be edited.
- **Selection bar.** Two or more selected: a toolbar `aria-label="Selection"` with "N selected" and
  `Delete selection`. It sits above the bounding box in the world overlay layer, drawn like the note toolbar.
  One sticky: story 2's `NoteToolbar`. Its Delete now deletes through the selection. While the board can't
  be edited, the multi bar still shows the count, but Delete is disabled (the note toolbar stays hidden, as
  in story 4). A visually hidden `aria-live="polite"` region always announces "N selected" (empty for none).
- **Marquee.** `BoardViewport` has a new optional `marquee` prop (`{ snapshot, onSelect }`) and runs
  `useMarquee` itself, because the camera lives there. Shift+press on empty space starts it instead of a pan
  (primary button only). The rectangle is drawn in screen space from a world rect. Escape during a marquee
  cancels it and does not also clear the selection. Shift+click on empty space without dragging leaves the
  selection as it is. The viewport reports `data-state="marquee"` while the rectangle is shown.
- **Keys.** `useBoardKeys` replaces the old Delete/Enter handler in `App.tsx`. Arrow keys with a selection
  always `preventDefault`, even on a load-failed board, where they don't move anything. Escape with nothing
  selected, and Delete/arrows with nothing selected, are not handled (default not prevented). Enter-to-edit
  works for exactly one selected object whose type has `editableText`.
- **Test hooks.** `window.__vidi6.selection()` (test builds only) returns the sorted selected ids. The e2e
  tests seed the 20-note cluster board (`clusterBoard()` in `tests/fixtures/boards.ts`) through the existing
  `/__test/boards/:id/seed` hook.
- **Test-only type.** `tests/fixtures/testbox.tsx` registers `testbox` (resizable, not aspect-locked,
  minSize 10). It is imported only by tests. Component test TC-24 uses it to show edge handles changing one
  axis and Shift keeping the ratio.
- **Browsers.** All story 7 e2e tests, including the five-window TC-36, pass in Chromium, Firefox and WebKit
  (repeated 3× without flakes). No browser skips were needed.
- **Red phase.** As in earlier stories, there are no separate commits for the failing tests. This build uses
  one commit per story.
- **Not covered here** (as the design says): the 200-note move/resize performance run and touch input.

## Story 8 — Undo and redo my own changes without undoing anyone else's

Decisions made where the spec left room:

- **Capture timing lives in the controller.** `Y.UndoManager` reads its clock through lib0, which keeps a reference
  to `Date.now` from import time. So its merge window can't be tested with `vi.setSystemTime` (TC-12, TC-13), and
  it would not match the app's clock. The manager is created with an infinite `captureTimeout`. The controller's
  own `afterTransaction` handler is registered before the manager's. It calls `stopCapturing()` when a
  LOCAL_ORIGIN transaction comes UNDO_CAPTURE_TIMEOUT_MS or more after the previous one. Exactly the timeout
  starts a new step; timeout − 1 ms merges.
- **Gestures use `beginStep()`, not only `boundary()`.** The design has frames merge because they are less than
  500 ms apart. A drag held still for half a second would then split into two steps and break undo.steps. So
  `onGestureStart` calls `beginStep()`, which is `boundary()` plus "keep this step open until the next
  `boundary()`". `onGestureEnd` calls `boundary()` (it also runs on pointercancel). There is a component test for
  a held drag.
- **One undo is one step, even if it has no effect.** Left to itself, `Y.UndoManager.undo()` keeps popping while a
  step changes nothing. For example, a step whose note someone else deleted would silently undo an *older* step as
  well. While `undo()`/`redo()` run, the controller hides the older stack items. A step with no effect is then just
  consumed ("nothing visible happens; the next undo continues normally", TC-07, TC-23). It still returns `true`,
  because the stack was not empty.
- **Extra controller members.** Besides the contract, the controller has `beginStep()` (above) and
  `topUndo()`/`topRedo()`. The text editor records the stack tops when editing starts. Ctrl/Cmd+Z inside the
  textarea undoes only while the top is above that mark, so it undoes typing in this note but never earlier
  actions (TC-16). Ctrl/Cmd+Shift+Z / Ctrl+Y inside the editor redo only what was undone there. The shortcut is
  always `preventDefault`ed in the editor, even when there is nothing to undo, so the browser's native textarea
  undo never diverges from the Y.Text.
- **`addScope` takes `Y.AbstractType<any>`.** With `AbstractType<unknown>` as in the design, a `Y.Map` is not
  assignable (its event type is invariant), so story 16 could not pass its comments map.
- **Controller lifetime.** `App.tsx` creates the controller in an effect keyed on the doc and destroys it in the
  cleanup. This is safe under StrictMode's double effects. Until the effect runs, a no-op `NO_UNDO` controller
  is used. The controller reaches the text editor and the note toolbar through `UndoContext` (in `useUndo.ts`).
- **Steps for single actions.** `asStep(controller, fn)` wraps a model call with `boundary()` before and after.
  Creating a note (double-click and toolbar), Delete/Backspace, the Delete buttons, each arrow-key nudge and
  colour changes use it. So two quick colour clicks are two steps, and a note's creation is separate from the
  typing that follows it.
- **Shortcuts.** Ctrl/Cmd+Z → undo, Ctrl/Cmd+Shift+Z → redo, and Ctrl+Y (Ctrl only, since Cmd+Y is browser
  history on macOS) → redo. They are handled in `useBoardKeys`'s modifier branch with `preventDefault`. They are
  ignored while a note is being edited (the editor handles them), when focus is in any other text field (e.g. the
  share link), and when the board can't be edited (the default is not prevented then either).
- **Buttons.** They sit below the Sticky note tool in the left toolbar, after a thin divider. Their tooltips are
  "Undo (Ctrl/Cmd+Z)" and "Redo (Ctrl/Cmd+Shift+Z)". They are `disabled` with `aria-disabled` when the stack is
  empty or the board failed to load.
- **Fixture.** `undoBoard()` in `tests/fixtures/boards.ts` has 12 notes in 6 colours and sizes from 180 to 240.
  The 8-note cluster is `ids[0..7]`. It is seeded through the existing test hook.
- **Unit-test peer.** `tests/unit/peer.ts` keeps a second real Y.Doc in sync synchronously with a non-local
  origin. Its "load" helper uses its own symbol with the same role as the worker's `LOAD_ORIGIN`, so client unit
  tests don't import worker code.
- **Browsers.** The story 8 e2e specs pass in Chromium, Firefox and WebKit (Chromium repeated 3× without flakes).

## Story 9 — Write free text anywhere on the board

Decisions made where the spec left room:

- **No identity.** Story 6 is not part of this build, so `createText` gets `createdBy = LOCAL_AUTHOR` (`'anonymous'`,
  exported from `App.tsx`) for every text object.
- **Type-specific snapshot fields.** `board-model` gained `registerSnapshotReader(type, reader)`. `src/shared/objects/text.ts`
  registers one, so `objectSnapshot` returns `TextSnapshot`s (`text`, `size`, `widthMode`) without board-model
  importing the text module. `maxZ` is now exported for `createText`. `readText(doc, id)` is an extra export used by
  box sync. `createText` starts with a one-empty-line box until the editing client measures it.
- **Shared text helpers.** `clampToLimit`, `limitEdit`, `applyTextDiff` and `transformIndex` moved to
  `src/shared/text-edit.ts` (the limit is a parameter there). `StickyText.ts` re-exports them with STICKY_TEXT_MAX_CHARS
  as the default, so story 2 code and tests are unchanged. `StickyTextEditor.tsx` is now a thin wrapper around the
  generalised `TextEditor.tsx`, which takes `undo` as a prop. It also has optional `className`, `ariaLabel`, `style` and
  `renderExtra` (the note counter). The editor finds its object as the closest `[data-object-id]`.
- **Layout rules.** Height is always lines × size × TEXT_LINE_HEIGHT, and an empty text counts as one line. Auto width
  is the longest line *before wrapping*, plus a new `TEXT_PADDING_WORLD` (4) of slack for the caret and rounding,
  capped at TEXT_MAX_AUTO_WIDTH_WORLD. So a text with a wrapped line is exactly 600 wide (TC-08/TC-26), and a line of
  exactly 600 stays on one line at width 600 (TC-09). Lines wrap greedily at spaces, and a word longer than the line
  breaks between characters (as `overflow-wrap: anywhere` does). The fallback estimate uses a new
  `TEXT_AVG_GLYPH_WIDTH_RATIO` (0.55).
- **Measuring with a canvas.** A document `<canvas>` is preferred over `OffscreenCanvas`: Firefox resolves
  `system-ui` to a different font in an OffscreenCanvas (412 vs 460 px for the same string), which made its wrapping
  differ from the DOM. In jsdom (no 2D context) the estimate is used directly, so component tests are deterministic
  and don't log jsdom's "not implemented" error.
- **Concurrent typing and the stored box.** As the design says, only the client that typed writes the box. When two
  people type into the same text at once, the last box write wins and may be measured from a text without the other
  person's latest characters. The text itself always merges. The box may then be a few units off until the next local
  edit. Text is drawn with `overflow: visible`, so nothing is hidden.
- **Resize through the registry.** `ObjectTypeSpec` gained `handles?: 'all' | 'horizontal'` and an optional
  `resize(doc, obj, to, { horizontalOnly })`. The transform gesture calls it (inside the gesture's transaction) instead
  of the generic write. So text needs no text-specific gesture code, and the registry keeps
  `onlyHorizontalHandles(objects)` for the overlay and gesture. Text's `resize` moves the text. It sets a fixed width
  when the drag is a side handle on text only (several texts: each gets its scaled width), and in mixed selections it
  scales only fixed widths. Then it re-measures the height. Horizontal-only types are left out of the height limit in
  `clampScale`, so a short text line never blocks shrinking a mixed group vertically.
- **Abandoned empty text and undo.** `UndoController` gained `joinSince(mark, change, { including })` and
  `topStepCreated(type)`. When editing ends with zero characters, the removal joins every step of that edit session
  into one:
  - For a text just created with the Text tool, the creation step joins too. The joined step then creates and removes
    the same things, so it is dropped. Undo never brings back an empty, invisible text (TC-20/TC-31).
  - For an existing text that was cleared, the joined step is the whole session. One undo brings the text back as it
    was before editing.

  `Y.UndoManager` merges into the top step while its `lastChange` is positive. `joinSince` relies on that, plus
  `Y.mergeDeleteSets` for the steps in between.
- **Text tool clicks.** `BoardViewport` has a new `onPlace(world)` prop. While it is set, capture-phase handlers own every
  primary press on the board or its objects (not on toolbars or the world overlay), and the release creates the text
  at the *pressed* point. Creating on release rather than on press keeps the browser's mousedown focus handling from
  pulling focus away from the new editor. The viewport gets `board-viewport--placing` and a text cursor.
- **Shortcuts.** V, T, N and Escape live in `useBoardKeys`. Escape with the Text tool active only returns to Select
  (the selection is kept). N was not bound before this story, so it now does what the Sticky note button does (a note
  in the centre of the view, being edited). The Sticky note button keeps its story 2 accessible name "Sticky note".
- **UI text not given by the spec.** The text toolbar is `role="toolbar"` "Text" with buttons "Size S", "Size M",
  "Size L", "Size XL" (showing S/M/L/XL, `aria-pressed`) and "Delete text". The editor textarea is named "Text". A
  text object is `role="group"` with `aria-roledescription="text"` and its content as its accessible name ("Empty
  text" while it is still empty). Tab reaches it, and focusing it selects it, as with notes.
- **Test hooks.** `window.__vidi6.objects()` returns `objectSnapshot` (all known types). The e2e text specs use it.
- **Browsers.** The story 9 e2e specs pass in Chromium, Firefox and WebKit. TC-26/27 compare the stored box height with
  the rendered height (±half a line).
- **Red phase.** As in earlier stories, there are no separate commits for the failing tests. This build uses one commit
  per story.

## Story 10 — Draw shapes and connect them with arrows that follow when moved

Decisions made where the spec left room:

- **Board-model hooks instead of an import cycle.** `deleteObjects` must detach connectors inside its transaction,
  and a connector's box and ends depend on other objects. `board-model.ts` cannot import `objects/connector.ts`
  (which imports board-model and registers itself at load time), so board-model gained three small hooks:
  `registerDeleteHook` (connector.ts registers `detachConnectorsTo`, run inside the delete transaction before the
  objects go — still one update and one undo step), `registerSnapshotFinisher` (after all objects are read,
  connectors get their resolved `ends` and derived x/y/width/height) and `registerPositionPlanner` (moving a
  connector with the generic `moveObjects`/`resizeObjects` shifts its free ends; attached ends stay on their
  objects; a connector's derived size may be 0).
- **`objectBounds` keeps a size of 0** (a horizontal or vertical arrow). Before, 0 was replaced by the sticky size.
- **`ConnectorSnap.ends`.** The snapshot carries both resolved ends so the registry hit test (which only gets the
  object) can measure the distance to the line. `hitTest` gained an optional `zoom` argument for the screen-space
  tolerance (`CONNECTOR_HIT_TOLERANCE_PX / zoom`).
- **Arrow hit area in real browsers** is an invisible SVG line with `pointer-events: stroke`, a round cap and a
  stroke width of twice the tolerance, so presses farther than 6 px from the line fall through to whatever is
  below. The press handler also checks `distanceToPolyline` (this is what jsdom tests exercise).
- **Registered components.** The registry passes `ObjectProps` to every type, so `ShapeObject` and `ConnectorObject`
  keep the design's props and are wrapped by small adapters (`ShapeObjectView`, `ConnectorObjectView`). The
  connector adapter gets the rects from a new `BoardContext` (all objects + client-to-world conversion), which the
  end handles also use to find the drop target. `BoardView` gained `toWorld(clientX, clientY)`.
- **Tools take `doc` and `by`.** `ShapeTool` and `ConnectorTool` need the doc to write to and the author id, which the
  contracts leave out; both are extra props. They render a full-viewport surface in the overlay layer that takes
  every press (so a Shape drag over a note never moves it) while the toolbar and zoom controls stay on top.
- **Shift squares in screen space.** The tool squares the dragged rect from the press point (so dragging up/left
  works) and also passes `square: true`; `createShape` squares from the rect's top-left, which is then a no-op.
  Squaring happens before the minimum-size check.
- **`useActiveTool` replaces story 9's `useTool`** (`src/client/board/useTool.ts` removed). It owns the tool
  shortcuts (V, T, S, L) and Escape-from-a-tool; `useBoardKeys` keeps N and does not clear the selection on an
  Escape that leaves a tool. The hook takes options (`canEdit`, `onSelectCreated`, `isEditing`) because
  `toolCreated` must select the new object. Letters for tools outside this build (N as a mode, P, I, C) are
  ignored by the hook. A new selection action `selectNew` selects an id this client just created, before the
  next prune has added it to the present set.
- **Accessible names.** Toolbar buttons "Shape (S)" and "Connector (L)" (like "Select (V)", "Text (T)"); the kind
  menu is `role="menu"` "Shape kind" with `menuitemradio` "Rectangle", "Ellipse", "Diamond". Swatches follow the
  design literally with the config's colour names: "blue fill", "none fill" (tooltip "No fill"), "red outline".
  The shape toolbar is `role="toolbar"` "Shape". Shapes are groups named "Rectangle" or "Rectangle: <label>";
  arrows "Arrow", "Arrow from <label> to <label>"; end handles "Arrow start" / "Arrow end"; the label editor
  textbox "Shape label".
- **Label layout.** The label is an HTML box inside the shape's div (not a `foreignObject`), inset to the largest
  centred rectangle inside the outline (ellipse: 1/√2, diamond: half size) with `SHAPE_LABEL_PADDING_WORLD`
  (new setting) padding, and uses story 2's `fitFontSize` (shrinks from STICKY_FONT_MAX_PX to STICKY_FONT_MIN_PX).
- **A lone selected arrow shows only its end handles** (registry flag `ownSelectionUi`), not a selection box.
- **Undo** uses the existing `asStep` helper (boundaries around the change) rather than calling
  `stopCapturing()` directly; creating, restyling and re-attaching are each one step.
- **E2E TC-27** holds Sam's outgoing WebSocket messages for 2 s with `page.routeWebSocket`, so Sam's delete reaches
  the server after Dana has drawn her arrow to the deleted shape.

## Story 11 — Sketch freehand with a pen

Decisions made where the spec left room:

- **Routing via a tool surface, not a BoardViewport change.** As with story 10's Shape and Connector tools, `PenTool`
  renders a full-viewport input surface in the overlay layer while the Pen is active. It takes every press on the
  board (objects included), so a pen drag never pans, draws a marquee or moves an object. Wheel and pinch events
  bubble up to the viewport's own listeners, so scrolling still pans and Ctrl/Cmd+scroll still zooms.
  `BoardViewport.tsx` did not need to change.
- **Types.** `PenColor` / `PenThickness` are defined in `config.ts` next to their settings (like `FillColor`) and
  re-exported from `objects/stroke.ts` as the design asks.
- **Identity.** `PenTool`'s `identityId` is story 10's `LOCAL_AUTHOR`, because story 6 (identity) is not in this build.
- **Undo.** Each commit (a whole stroke, or each part of a split long stroke) goes through the existing `asStep`
  helper (a boundary on each side, like story 10) instead of calling `stopCapturing()` directly.
- **Dots and splitting.** A press counts as a dot if the pointer never moves `DRAG_THRESHOLD_PX` or more from where
  it was pressed. When the raw points reach `STROKE_MAX_POINTS`, that part is simplified and committed, and drawing
  continues from its last point. If the release adds nothing beyond that join point, no extra dot is committed.
  Taking the Pen away mid-stroke (Escape, another tool, or the board becoming read-only) keeps the stroke drawn so
  far, the same as an interrupted stroke.
- **Smoothing tolerance** is `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`, using the zoom when the stroke began. RDP
  measures the distance to the segment, not to the infinite line, so every drawn point is within the tolerance of
  the stored polyline. The rendered `smoothPath` (midpoint quadratics) rounds the corners of that polyline.
- **Preview.** The preview is a screen-space SVG polyline. Its `d` attribute is set directly once per animation frame,
  with no React re-render per pointer move. It follows the camera if the view changes mid-stroke.
- **Cursor.** The pointer is hidden over the Pen surface. It is replaced by a round dot in the pen's colour with
  diameter `thickness × zoom`, with a minimum of 2 px so a thin pen stays visible when zoomed out.
- **Hit area.** Clicks reach a stroke only through an invisible polyline path (`pointer-events: stroke`, width
  2 × the tolerance, round caps and joins). The rest of the stroke's box ignores the pointer, so a click there
  reaches whatever is underneath. The press handler also checks `distanceToPolyline`, which is what the jsdom tests
  exercise.
- **Accessible names.** Toolbar button "Pen (P)", following the other tools. Pen toolbar `role="toolbar"` "Pen" with
  "black pen" … "purple pen" and "Thin" / "Medium" / "Thick" (all with `aria-pressed`). A stroke is
  `role="group"` "Drawing" (`aria-roledescription="drawing"`). Tab reaches it, and focusing it selects it. The
  visible path also has `aria-label="Drawing"`, but its SVG is `aria-hidden` so the name is not read twice.
- **Resize minimum.** A straight thin stroke is only 2 units tall, which is below `STROKE_MIN_SIZE_WORLD` (4). Story
  7's `clampScale` would have forced such a stroke to grow the moment it was resized. It now only stops a side
  already below its minimum from shrinking further; it no longer forces it to grow. Every other type is unchanged,
  because its objects are never below their minimum.
- **Existing test update.** `useActiveTool.test.tsx` checked that P is ignored, because the Pen was not in the build.
  It now checks C instead, since the Pen is part of the build.

## Story 12 — Drop images onto the board

Decisions made where the spec left room:

- **Uploader identity without sign-in.** Story 6 (identity) is not in this build, and story 9's `LOCAL_AUTHOR` is the
  same for everyone, so it can't tell the uploader apart from others. Each browser tab gets a random id kept in
  `sessionStorage` (`src/client/images/uploaderId.ts`), and it is written as `uploaderId`. A reload of the same tab
  keeps the id: the uploader still sees "Upload failed", but only with Remove, because the file for Retry was in
  memory. Other tabs and other people see "Image unavailable". `App` takes an optional `identityId` prop for tests.
- **Hook inputs.** `useImageInsert` takes `toWorld(clientX, clientY)` and `viewCentre()` instead of the design's
  `camera`, because the drop point needs the viewport's position as well. It also takes `undo` (placeholder creation
  goes through `asStep`, so one add action is one undo step) and `isEditing`. Besides the contract, it returns
  `onDragEnter`/`onDragLeave` (for the highlight), `pickerInput` (props for the one hidden `<input type=file>` rendered
  on the board), `dragging`, `message`/`dismissMessage` (toast) and `forget(id)` (Remove drops the kept file).
  `BoardViewport` gained a `dropTarget` prop that passes the drag events through.
- **Image tool is an action, not a mode.** The Image button ("Image (I)") and the I key open the picker, and the
  tool stays on (or returns to) Select. `useActiveTool` got an `onImage` option for the I key. The button and key
  are off while the board can't be edited. While the board is connecting or reconnecting, they show the offline
  toast instead of opening the picker. Uploads start only in `connected`/`confirmed`.
- **Toasts.** One toast can list several messages, e.g. a type refusal and a size refusal from the same drop. It is
  `role="status"` / `aria-live="polite"` at the bottom centre and disappears after the new `TOAST_DURATION_MS`
  (5 s).
- **Decode failure = type refusal.** The client checks `File.type`. A PDF renamed to .png passes that check but
  fails `createImageBitmap`, so it gets the type message and no placeholder (TC-26, TC-29). The server sniffs the
  content again anyway.
- **Undo and redo.** The unit test confirms what the design left open: after undoing an insertion, `Y.UndoManager`
  redo brings the images back together with the status that `UPLOAD_ORIGIN` wrote (`ready` and the asset key).
- **Clock.** While any image is `uploading`, `useClock` re-renders every new `IMAGE_STATUS_TICK_MS` (30 s), so
  "Image upload didn't finish" appears without any interaction. The uploader's own upload that is still running is
  never shown as unfinished, however slow it is.
- **Load errors.** An `<img>` error is remembered only for that asset key. A successful load, or a different key,
  shows the image again.
- **Accessible names.** An image object is `role="group"` with `aria-roledescription="image"` and the name "Image".
  The `<img>` has `alt="Image"`. The uploader's progress bar is `role="progressbar"` "Upload progress". Buttons
  are "Retry" and "Remove".
- **Routes.** `/api/assets/*` falls under the existing `run_worker_first: ["/api/*"]`. A key is decoded before it is
  checked, so `..%2Fx` gets 404. An unencoded `/api/assets/../x` is normalised by URL parsing before it reaches the
  Worker.
- **Rate limit** uses a second `ratelimits` binding, `ASSET_UPLOAD_LIMITER` (namespace 1002). A unit test checks it
  against `IMAGE_UPLOAD_LIMIT`/`IMAGE_UPLOAD_PERIOD_SECONDS`, as story 5 does for its limiter. The integration test
  uses the real local binding. The e2e specs give each browser context its own `CF-Connecting-IP`.
- **Fixtures.** `tests/fixtures/images/` holds the generated fixtures: a 1440x900 PNG, a 4032x3024 JPEG (about
  1.5 MB, not 3 MB, to keep the repository small), an animated GIF, a WebP, an SVG with a script, a PDF renamed to
  .png and a truncated PNG. `tests/fixtures/images.ts` has small inline images for the Workers and jsdom runtimes,
  plus `jpegOfSize` for the exact 10 MB boundary. The 11 MB e2e file is generated in the test.
- **E2E TC-25** holds Leo's upload requests for 2 s with `page.route`, so the "Uploading…" state is on Sam's
  screen long enough to observe it (local uploads finish too fast otherwise).
- **Browsers.** All story 12 e2e specs pass in Chromium, Firefox and WebKit.
