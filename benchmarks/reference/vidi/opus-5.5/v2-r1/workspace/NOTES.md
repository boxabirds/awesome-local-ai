# Implementation notes

Decisions made while implementing without anyone to ask.

## Story 1 — Pan and zoom around an infinite board

- **Where `useCamera` lives.** The design's `BoardViewport(props: { children })` contract has no camera props,
  yet the camera needs the viewport's measured size. `BoardViewport` therefore owns `useCamera` and renders
  `ZoomControls` and `NavigationHint` as overlay siblings of the input surface; `App.tsx` just mounts
  `<BoardViewport />`. Because the controls are siblings (not children) of the wheel-listening surface, a
  Ctrl-wheel over them never reaches the board and the browser default is not suppressed there (TC-30).
- **`useCamera` extras.** Besides the contract members it exposes `isPanning` (drives the grab/grabbing cursor
  and `data-state="idle|panning"`) and `zoomAt(point, factor)` (used by the Safari gesture handler).
- **Keyboard shortcuts** are handled on `window` (the whole page is the board) but ignored while typing in
  inputs/textareas/contenteditable, so later text-editing stories are unaffected. `+`/`_` and numpad keys are
  accepted as aliases of `=`/`-`.
- **Grid dots** are a CSS radial-gradient centred in each tile, so the background position is shifted by half a
  tile to keep dots on world multiples of `GRID_SPACING_WORLD`.
- **Initial view** is `resetCamera(viewport)` (100%, origin centred). Window resizes change only the viewport
  size; the camera's top-left anchor is unchanged.
- **Test hook.** `window.__vidi6.{setCamera,getCamera}` is installed only when `import.meta.env.MODE === 'test'`
  (verified absent from the production bundle). `npm run build` is the production build; e2e runs
  `npm run build:test` (same `dist/client` directory) and serves it with `wrangler dev`.
- **Red-phase commit skipped.** Task 1 asks for a separate commit of failing tests; the session rules ask for a
  single story commit, so the unit tests and implementation land together.
- **Firefox e2e.** In the build environment Firefox cannot start (`sandbox_init() failed: Operation not
  permitted`; `newPage` times out). Chromium and WebKit pass. `E2E_BROWSERS=chromium,webkit npm run test:e2e`
  selects a subset; the default still runs all three browsers.

## Story 2 — Capture ideas on sticky notes and rearrange them

- **Camera access for notes and toolbars.** `BoardViewport` still owns `useCamera` (story 1). It now takes
  optional props: `children` may be a render function `({ camera, viewport }) => …` (world layer), `overlay`
  renders screen-space content (the left `Toolbar`), and `onEmptyDoubleClick(world)` / `onEmptyClick()` report
  double-clicks and clicks (press + release under `DRAG_THRESHOLD_PX`) on empty board space. `App.tsx` wires
  these to the model and selection.
- **`createSticky` returns `string | false`.** The contract says `string`, but TC-39 requires rejecting
  non-finite coordinates with `false`. No-op mutations (move to the same spot, same colour) also return `false`
  without a transaction, as the contract's "false when rejected or a no-op" says. `StickyNote` therefore ends a
  drag only when the note no longer exists (`hasObject`), not on every `false`.
- **Stacking without DOM reordering.** Notes are rendered in creation order and stacked with CSS `z-index` equal
  to their rank in `(z, id)` order (`layer` prop on `StickyNote`). Moving the dragged node to the end of the DOM
  on `bringToFront` could drop pointer capture and focus mid-drag.
- **Note toolbar** is rendered by `StickyNote` as a world-layer sibling anchored at the note's top centre,
  counter-scaled by `1/zoom` (screen-sized) and above every note. It is hidden while dragging or editing.
- **Length limit on edits in the middle.** `clampToLimit` truncates (contract, TC-14–16). The editor uses
  `clampEdit(prev, next)`, which drops only the part of the *inserted* text that does not fit, so typing or
  pasting in the middle of a full note never cuts existing text at the end. Caret goes after the kept insert.
- **Selection details.** Keyboard focus (Tab) on a note selects it; a pointer press selects on release
  (Pressed → Selected). Escape ends editing and returns focus to the note so Enter/Delete keep working. Enter on
  a focused button is left to the button. A deleted note is dropped from the selection automatically.
- **Editing layout.** The textarea is sized to the measured text height so text stays vertically centred while
  editing; a hidden measuring element (same padding/width) drives `fitFontSize`. The fade is shown only when not
  editing (the textarea scrolls instead so the caret stays visible); the `is-overflowing` class is set either way.
- **Test hooks.** `window.__vidi6` is now assembled from parts: `useCamera` adds `setCamera/getCamera`,
  `useBoardDoc` adds `getNotes()` (test builds only). `App` accepts an optional `doc` for component tests.
- **Component tests with user-event** fake only `requestAnimationFrame` (Testing Library's async wrapper stalls
  when `setTimeout` is faked by Vitest).
- **Red-phase commits skipped** (tasks 1 and 3), as in story 1: one story commit.
- **Firefox e2e** still cannot start in this environment (sandbox error); all e2e pass in Chromium and WebKit.

## Story 3 — See other people's edits appear live on the same board

- **Vitest pinned to ^4.1.** `@cloudflare/vitest-pool-workers` (0.22, the latest) supports only vitest 4 and
  fails to start its pool under vitest 5. The design asks for one `vitest.config.ts` with an `integration`
  project on that pool, so the repo moved from vitest 5.0 to 4.1; unit and component suites run unchanged.
- **`compatibility_date` lowered to 2026-08-15** (was 2026-09-01). The workerd bundled with the pool rejects
  newer dates. No runtime behaviour depended on the later date.
- **Workers types.** `src/worker/worker-configuration.d.ts` is generated by `npm run cf-typegen`
  (`wrangler types`). Worker code and `tests/integration` are typechecked with `tsconfig.worker.json`
  (no DOM lib); `npm run typecheck` runs both configs.
- **Binary frames.** With current compatibility dates workerd delivers binary WebSocket frames as `Blob`; the
  room sets `binaryType = 'arraybuffer'` on accepted sockets.
- **Asset routing.** `assets.run_worker_first: ["/api/*"]` so only room requests invoke the Worker; any
  other path is served from assets (SPA fallback). Anything under `/api/rooms/` that is not a valid id
  (including extra path segments) is a 400.
- **`readSync` in `protocol.ts`.** y-protocols' `readSyncMessage` logs and swallows `applyUpdate` errors, so
  the room could not close a socket that sent an invalid update. `readSync` handles the three sync
  sub-types itself and lets Yjs errors throw (→ close 1003).
- **Live text while editing.** Story 2's editor textarea was uncontrolled and wrote a diff against the
  current Y.Text on every input, which would have erased other people's concurrent typing. The editor now
  observes its Y.Text: remote changes are written into the textarea immediately with the caret/selection
  mapped through the change (`transformIndex`); during IME composition they are queued and the local edit
  is merged over them when composition ends (`applyTextEditOver`). Text inserted exactly at the caret goes
  after the caret.
- **Offline detection.** Besides y-websocket's own 30 s no-message watchdog, `connectBoard` restarts the
  connection on the browser's `offline` event (so "Reconnecting…" appears at once) and retries immediately on
  `online` instead of waiting out the backoff.
- **State mapping** lives in `trackConnectionState(provider, onState)` (exported from `connectBoard.ts`) so the
  component tests drive it with a fake event emitter. A `sync(false)` or `disconnected` after the first sync
  means `reconnecting`; before the first sync the state stays `connecting`. `connectBoard` also destroys the
  provider's awareness instance on teardown (its renewal timer would otherwise keep running).
- **Delete during edit/drag** needed no new code: `App` already drops a selected/edited id once the note is no
  longer in the snapshot (story 2), and the deleted note's `StickyNote` unmounts, which ends its drag.
- **Routing.** `/b/<valid id>` opens that board. Any other address (including `/b/<invalid>`) is replaced via
  `history.replaceState` with `/b/<newBoardId()>` — temporary until story 5. Component tests render `App`
  without a `boardId` (local board, no badge).
- **Badge** is rendered next to the viewport, `pointer-events: none`, so it never blocks the board. It is
  found in tests by its class because the zoom label (`<output>`) also has the `status` role.
- **Test hooks** (test builds only): `window.__vidi6.connectionState`, `connectionHistory` and `unmount()`.
- **Integration TC-04** calls the real Worker `fetch` handler with the real namespace wrapped in a recording
  proxy (a spy on the binding cannot see calls made through `SELF`). **TC-18** simulates a restart with a
  fresh board id, as the design says.
- **E2E browsers.** The live-collaboration spec runs TC-22/TC-23 in every configured browser and the rest in
  Chromium only (as in the design). Firefox still cannot start in this environment; runs used
  `E2E_BROWSERS=chromium,webkit`. Nightly TC-29/TC-30 live in `tests/e2e/nightly` and run only via
  `npm run test:e2e:nightly` (Chromium). In TC-30 each participant edits their own notes in their own area of
  the board, so UI gestures never collide; convergence across everyone's changes is still asserted.
- **Red-phase commits skipped** (task 1), as in earlier stories: one story commit.

## Story 4 — Return to a board and find everything as it was left

- **Room state vs. `RoomState` in the contract.** The contract's room-level type is
  `'ready' | 'load-failed' | 'storage-failed'`; the room actually tracks the full lifecycle from the
  design's state diagram (`loading`, `ready`, `compacting`, `storage-failed`, `hibernated`,
  `load-failed` with its failure time) through the pure `nextRoomState` in `src/worker/room-state.ts`
  (TC-27). `hibernated` is never observed by code (the runtime evicts the object; the constructor
  reloads), but the edge is modelled and tested.
- **Damaged log rows and Yjs causality.** Yjs updates from one client form a chain: after a
  quarantined row, every later change by that client would stay "pending" forever, losing far more
  than one change. After quarantining, `load` bridges each gap with a garbage-collected range
  (`bridgeMissing`), so later changes apply and only content built directly on the missing change is
  dropped (PRD persist.partial_damage). TC-09 compares against a doc built from every other row.
- **Updates are parsed completely before they are applied** (`Y.decodeUpdate`), both on load and in
  `readSync`: Yjs can integrate part of a malformed update before throwing, which would otherwise
  store or apply half of it.
- **`compactIfNeeded(doc, force?)`.** The contract has one argument; an optional `force` compacts
  regardless of thresholds. Tests use it for snapshot states without writing 500 rows, and the
  TC-24 corruption hook uses it so there is a snapshot to damage.
- **Per-row limit.** SQLite-backed Durable Objects allow 2 MB per row/BLOB (Cloudflare limits page
  as of this build); `SNAPSHOT_CHUNK_BYTES` (512 KiB) stays well under it.
- **Load-failed client state is sticky.** `connection-close` with 4500 → `load_failed`; later
  closes with other codes (e.g. a network drop between retries) keep `load_failed` until a sync
  succeeds, so the board is never presented as empty and editable. 1011/1003 map to `reconnecting`.
  The provider's own backoff (up to `RECONNECT_MAX_BACKOFF_MS`) does the retrying.
- **Edit lock.** `canEdit(state)` gates creation (double-click, Enter, the now-disabled Sticky note
  button), Delete/Backspace, drag (also ended mid-gesture), text editing, and the note toolbar
  (colour/delete). Selection is cleared while locked because a selected note shows the toolbar.
- **Test hooks.** `src/worker/test-hooks.ts` routes (`POST /__test/boards/:id/corrupt-snapshot` and
  `/repair`) exist only when `env.TEST_HOOKS === '1'`, which only e2e `wrangler dev` sets via
  `--var TEST_HOOKS:1` (Playwright webServer). `/__test/*` was added to `run_worker_first`; without
  the variable the Worker passes such requests to the assets (SPA), which an e2e test verifies.
  Corrupt compacts, overwrites chunk 0 with 0xFF bytes (never a valid varint), reloads the room and
  closes its sockets with 4500; the original chunk is kept in a test-only table for `repair`.
- **E2E layout.** `tests/e2e/persistence.spec.ts` runs in its own `persistence` Playwright project
  (Chromium) and starts, SIGKILLs and restarts its own `wrangler dev --persist-to <tmp>` processes
  (`helpers/wrangler-process.ts`); it serves the test build the shared webServer produced.
  `helpers/seed.ts` writes fixture boards over the room protocol from Node. TC-24 lives in
  `tests/e2e/broken-board.spec.ts` against the shared server.
- **Large-board render time.** First measurement of TC-21 was ~9.5 s, almost all of it client
  render: every note's font fitting forces layouts, and with 2,000 absolutely positioned siblings
  each forced layout was expensive. `.sticky-note` now has `contain: layout size style` (the note is
  a fixed 200×200 box), which brought it to ~1.3 s alone and ~2.9 s with the whole suite running in
  parallel (logged, not asserted, as the design says).
- **Story 3 TC-18 assertion updated.** It asserted that a freshly started room has no doc at all
  (`null`); rooms now load their (empty) saved board on construction, so it asserts an empty board.
- **`FakeWebSocket`** moved from `ConnectionStatus.test.tsx` to `tests/component/fakeWebSocket.ts`
  (with a close code) so the load-failure component tests share it.
- **Typecheck split.** The two unit suites that import worker modules (`board-store-chunks`,
  `room-state`) are typechecked with `tsconfig.worker.json` (Workers types), as is `tests/fixtures`.
- **Red-phase commit skipped** (task 1), as in earlier stories: one story commit.
- **Firefox e2e** still cannot start in this environment; runs used `E2E_BROWSERS=chromium,webkit`.

## Story 5 — Share a board with others using a link

- **`App` stays the board; `Root` is the router.** The design says `App.tsx` "renders router". Component
  tests from stories 2–4 render `App` as the board (with `boardId`/`doc` props), so `App` keeps that role
  and `App.tsx` gains `Root` (Home / `BoardPage` keyed by id / Board not found), which `main.tsx`
  renders. `BoardPage` mounts `App` + `SharePanel` only in the `ready` state. Story 3's
  `boardIdFromLocation` redirect is deleted.
- **Shared New board action.** `pages/useCreateBoard.ts` + `pages/NewBoardButton.tsx` are used by both
  the Home and Board not found pages (the design's "reuses HomePage's create action"). A second click
  while creating is ignored. The link back home reads "Go to the home page".
- **`nextBoardPageState` has an optional 4th argument** (`boardId`) so `ready` can carry the id; the
  retry delay is `retryDelayMs(attempt)` (base × 2^(attempt−1), capped at `RECONNECT_MAX_BACKOFF_MS`).
  `checkBoard` treats any answer other than 200/404 as `unreachable`; `createBoardRequest` treats any
  answer other than a 201 with a valid id as `failed`.
- **Routes.** `/` home, `/b/:id` board (the id is validated by `BoardPage`, so `/b/bad` is Board not
  found without a request), everything else (including `/b/<id>/extra`) Board not found.
- **Worker.** `GET`/`HEAD` on `/api/boards/:id`, `POST` on `/api/boards`; other methods 405 (with
  `Allow`). JSON answers are `Cache-Control: no-store`. A malformed id on `/api/rooms/` is now 404
  (story 3's integration TC-04 updated from 400 to 404, as the design's HTTP contract says). The room's
  own `fetch` answers 404 for a board that does not exist, before accepting a socket; if the existence
  query itself throws, the room proceeds so the story 4 load-failed path explains the problem instead
  of "not found".
- **Storage.** `BoardStore.load()` no longer migrates: missing tables load as an empty board and are not
  created. `migrate()` runs in `initialize()` and lazily before the first `append()` (also before a
  quarantine or compaction). `existsReadOnly()` checks `sqlite_master` first. `created_at` is stored in
  `storage_meta` (epoch ms).
- **`compatibility_date` unchanged** (2026-08-15): Durable Object RPC needs 2024-04-03 or later.
- **Existing tests create boards first.** Connecting no longer creates a board, so story 3/4
  integration tests use `createBoardId()` (POST through the real Worker, `tests/integration/ws-client.ts`)
  and e2e helpers create boards with New board (`openBoard`) or `createBoardViaApi` (participants,
  persistence, broken board).
- **Legacy seeding (e2e TC-31)** uses a new TEST_HOOKS-only route `POST /__test/boards/:id/seed-legacy`
  (body: one Yjs update) that writes update rows without `created_at`; the "hooks absent in production"
  e2e check covers it too. The fixture is story 4's retro board merged into one update.
- **Share panel.** Focus returns to the Share button on Escape and on an outside click (TC-25). Escape and
  outside pointerdown are handled in the capture phase while the panel is open. The tick in "Link
  copied" is `aria-hidden`, so the button's accessible name is exactly "Link copied".
- **TC-22's https link** is tested by giving the SharePanel test file a jsdom URL of
  `https://vidi6.example/` (per-file environment options).
- **E2E browsers.** TC-26, TC-28 and TC-31 run in Chromium only (TC-26 needs clipboard permissions);
  TC-27 and TC-29 in every configured browser. Firefox still cannot start in this environment
  (sandbox error); runs used `E2E_BROWSERS=chromium,webkit`.
- **Red-phase commit skipped** (task 1), as in earlier stories: one story commit.

## Story 7 — Select, move, resize and delete several objects at once

- **Snapshot of every object.** `objectsSnapshot(doc)` returns all objects that have a type and a
  position (including types this client does not know), with `width`/`height` read with the
  STICKY_SIZE_WORLD fallback. `snapshot(doc)` still returns sticky notes only (story 2's TC-12).
  `useBoardDoc` now exposes `objects`; `App` renders only registered types through the registry.
  `ObjectSnapshot` is the common base interface; `StickySnapshot` extends it.
- **New stickies store their size.** `createSticky` writes `width`/`height` = STICKY_SIZE_WORLD
  (the design's "object created after this story → ExplicitSize"); old notes stay implicit until
  their first resize.
- **Unknown types in shared code.** `board-model` is framework-free and cannot see the client
  registry, so `objectsInRect` and `allObjectIds` take an optional `isKnownType` predicate
  (default: types the model reads, i.e. `sticky`); the client passes `isRegisteredType`.
- **`clampScale` has an optional 5th argument `uniform`** (default: `scale.x === scale.y`) so an
  aspect-locked resize stays uniform after clamping. `geometry.ts` also exports `handleScale` and
  `scaleFromHandle` (resize = scale from the opposite side; the axis an edge handle does not move
  scales around the centre when aspect-locked). Corners with aspect lock follow the axis the
  pointer moved further, so TC-01's 200×200 + (100, 40) gives 300×300.
- **Camera for gestures.** `BoardViewport` owns the camera (story 1), so `useTransformGesture`
  accepts `camera` as a `Camera` or a getter; `App` passes a getter backed by a new
  `cameraRef` prop of `BoardViewport` (no extra App render per camera frame). The marquee lives
  inside `BoardViewport` (`marquee` prop) with the real camera; the rectangle is drawn in the world
  layer. Escape during a marquee cancels it without also clearing the selection.
- **Pointer model.** Pressing an unselected object selects it at pointerdown (then drags only it);
  pressing a member of a multi-selection moves the group, and a click without a drag selects just
  that member. Shift-press on an unselected object adds it immediately; Shift-click on a selected one
  removes it on release (so Shift-dragging a selected object still moves the group). Gesture events
  are followed on `window` after pointer capture; `lostpointercapture` cancels.
- **Selection reducer and "absent ids".** The reducer keeps the ids present at the last `prune` and
  ignores `click`/`toggle`/`setMany` for others. `edit` is not checked, because a new note is edited
  before a snapshot containing it has been pruned against. `prune` keeps the same state object when
  only positions changed, so drags do not cause extra renders.
- **Locked board (story 4) and selection.** The PRD now allows selecting a board that failed to load
  for viewing. Selection works; handles, the note toolbar, dragging, resizing, nudging, deleting
  and Enter-to-edit do not (the bar's Delete button is disabled). Story 4's rule "selection is
  cleared while locked" is replaced by this.
- **Note toolbar placement.** The note toolbar (single sticky) and the "N selected" bar are both
  rendered by `SelectionBar` in screen space above the selection's bounding box (the note toolbar
  was a counter-scaled world-layer element in story 2). Both are hidden during a gesture or
  while editing; the `aria-live="polite"` "N selected" announcement is always mounted.
- **Bigger notes, bigger text.** A resized sticky lays its content out at STICKY_SIZE_WORLD wide and
  scales it by `width / STICKY_SIZE_WORLD` (fit uses the width-derived box), so an enlarged
  headline note shows larger text rather than more room at the same font size.
- **Handles** are `role="button"` elements (`aria-label="Resize top-left"` …) that are not in the tab
  order (resizing is a pointer interaction). A transparent pseudo-element enlarges their hit area
  beyond HANDLE_SIZE_PX. A single selected object also gets the bounding box and handles.
- **Test-only `testbox` type** lives in `tests/component/testbox.tsx`, not `tests/fixtures`:
  `tests/fixtures` is typechecked with the Workers config (no DOM) and the type is a React
  component. The unit registry test imports it too.
- **Fixture.** `selectionBoard()` in `tests/fixtures/boards.ts`: a 4 × 3 grid cluster and 8
  overlapping notes (20 notes), seeded through the room protocol.
- **LoadFailure TC-23** now also spies the new group operations and checks that arrows and resize
  handles do nothing on a locked board.
- **E2E browsers.** TC-32 runs in every configured browser, the rest in Chromium only. Firefox still
  cannot start in this environment; runs used `E2E_BROWSERS=chromium,webkit`.
- **Red-phase commits skipped** (tasks 6, 7, 9), as in earlier stories: one story commit.

## Story 8 — Undo and redo my own changes without undoing anyone else's

- **Capture window timed by the controller.** lib0 (used by Y.UndoManager) keeps its own
  reference to `Date.now`, so fake clocks cannot reach Yjs's `captureTimeout` (TC-13 could not be
  tested exactly). `createUndo` therefore gives Yjs an effectively infinite capture timeout and
  calls `stopCapturing()` itself before a LOCAL_ORIGIN transaction that starts
  UNDO_CAPTURE_TIMEOUT_MS or more after the previous local one. Same semantics: a pause of exactly
  UNDO_CAPTURE_TIMEOUT_MS starts a new step, one ms less merges.
- **One press = one step, even when the step has no effect.** Y.UndoManager silently skips steps
  that change nothing (a move of a note someone else deleted) and undoes the next one in the same
  call. The PRD wants "nothing visible happens; the next undo continues normally", so `undo()` /
  `redo()` expose only the top stack item to Yjs; a no-effect step is consumed on its own.
- **Controller lifetime.** `App` creates the controller in an effect (StrictMode-safe) and
  provides it through `UndoContext` (`useUndo.ts`), which is how `StickyTextEditor` (rendered by
  the object registry) reaches it; `useUndo` therefore accepts `UndoController | null` (null
  before the effect runs, and in isolated editor tests where the editor keeps native behaviour).
- **Editor shortcuts.** Inside the note editor Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z / Ctrl+Y
  redo through the board history (so the textarea never diverges from the Y.Text); these steps are
  whatever is on top of the person's history (normally the typing burst in that note).
- **Shortcut rules.** `undoShortcut()` in `useBoardKeys.ts` is shared by the board and the editor.
  Ctrl+Y is redo only with Ctrl (Cmd+Y is left to the browser). Shortcuts in other text fields
  (share link) are left alone; on a load-failed board they are ignored without preventDefault.
- **Boundaries.** Gesture start/end, edit start/end/Escape, and before and after create, colour,
  delete (bar and key) and each arrow-key nudge (one nudge = one step).
- **Fixture.** `undoBoard()` in `tests/fixtures/boards.ts`: 12 notes in varied colours and sizes,
  8 in a 4 × 2 cluster.
- **Red-phase commits skipped** (tasks 6, 7), as in earlier stories: one story commit. E2E runs
  used `E2E_BROWSERS=chromium,webkit` (story 8 e2e is Chromium only; Firefox cannot start here).

## Story 9 — Write free text anywhere on the board

- **Box width rules.** Auto width = longest line *before wrapping* (measured, rounded up) plus
  `TEXT_CARET_SLACK_WORLD` (2) so the caret fits, at least `TEXT_MIN_WIDTH_WORLD`, at most
  `TEXT_MAX_AUTO_WIDTH_WORLD`; once any line wraps the box is the full 600 (PRD verification: a
  300-character sentence gives a 600-wide box). A line of exactly 600 does not wrap (TC-09). Heights
  are rounded to 0.01 to keep float noise out of the stored box. Wrapping is greedy by words, spaces
  hang at line ends (like CSS `pre-wrap`), and words longer than the box are broken by character.
  The measurer falls back to `TEXT_AVG_GLYPH_WIDTH_RATIO` × font size per character without canvas
  (both named settings added to `config.ts`). The DOM renders with `white-space: pre-wrap` at the
  stored width; e2e checks that the browser shows as many lines as were measured.
- **Resizing through the registry.** `ObjectTypeSpec` gained `handles`, plus two optional hooks so
  the generic gesture stays type-agnostic: `resizeLimits(obj, widthOnly)` (text limits only a width
  being set or already fixed; its height never limits) and `applyResize(doc, obj, rect, widthOnly)`
  (text: move, `setTextWidthFixed` when side handles only or already fixed, re-measure). A resize
  frame is now one transaction for all types. With only side handles shown, only e/w drags resize.
- **Undo of new text.** The Text tool click closes the previous step but not the creation step, and
  the editor skips its start boundary when the text is empty when editing starts, so creating and
  first typing are one step: undo removes the new text entirely instead of leaving an empty,
  invisible one. On edit end the empty-text removal runs before the closing boundary (in the step
  of the last edit). Abandoning a new text without typing leaves one no-effect step (create +
  remove), which story 8 allows ("nothing visible happens").
- **Text tool clicks** are handled in the capture phase on the board surface (so a click on top of
  a note creates text there instead of selecting the note); the text is created on release, at the
  press point. `BoardViewport` gained `onPlace` and `viewportRef` props.
- **Shortcuts.** V, T, N and Escape live in `useBoardKeys` (ignored while editing or typing in a
  field, with Ctrl/Cmd/Alt, and with Shift). N prevents the key's default so the new note's editor
  does not receive an "n". Escape with Text active returns to Select (and does not clear the
  selection).
- **`TextEditor`** takes `undo` as an optional prop (default: the `UndoContext` controller, as in
  story 8) and adds `ariaLabel`, `className`, `boundaryOnStart` and `after(length)` (the sticky
  counter) so `StickyTextEditor` is a thin wrapper. The outside-click check now uses
  `[data-object-id]`.
- **Accessible names.** Text objects are `role="group"` with `aria-roledescription="Text"` and the
  content as the name ("Text" when empty); the editor is the textbox "Text". Size buttons show
  S/M/L/XL and are named "Text size XL (Extra large)" etc.; the toolbar is "Text toolbar" and its
  delete button "Delete text". Existing component tests now look up the renamed "Sticky note (N)"
  button (and its new tooltip).
- **`createdBy`.** Story 6 (identities) is not in this build, so each tab uses an anonymous
  `g_<uuid>` id.
- **Selection prune fix.** `useSelection` dispatched a no-op `prune` in a passive effect on every
  snapshot change. When five people type at once, many remote updates arrive before React's
  deferred render runs, and React counted those as a nested update loop ("Maximum update depth
  exceeded" inside the Yjs update handler, found by TC-30). The effect now dispatches only when the
  prune would change the state.
- **Story 7 TC-36 grab point.** The left toolbar is taller now (Select and Text buttons) and covered
  the grid note the fifth participant pressed at its centre (x≈65 px). The test now presses the
  notes on their right half.
- **Test hooks.** `window.__vidi6.getObjects()` returns every object (text included). jsdom has no
  canvas: `tests/component/textHelpers.tsx` stubs `getContext` to return null (no "Not implemented"
  noise), so component tests use the estimate measurer.
- **E2E browsers.** All text e2e tests run in every configured browser. Firefox still cannot start
  in this environment (sandbox error); runs used `E2E_BROWSERS=chromium,webkit`.
- **Red-phase commits skipped** (tasks 1, 3), as in earlier stories: one story commit.

## Story 10 — Draw shapes and connect them with arrows that follow when moved

- **Active tool hook.** Story 9's `board/useTool.ts` is replaced by `tools/useActiveTool.ts` (the
  design's file). It takes `{ canEdit, select }` (the contract has no arguments, but it needs the
  lock state and the selection for `toolCreated`). `TOOL_SHORTCUTS` lists every cross-story
  letter; only the tools in this build (`MODE_TOOLS`: select, text, shape, connector) can be
  activated. Shortcut handling stays in `useBoardKeys` next to V/T/N (same rules: ignored while
  editing, in fields, with modifiers). A new selection action `selectNew(id)` selects an object
  created in the same event (like `edit`, it is not checked against the last pruned snapshot).
- **Tool layer.** `BoardViewport` gained `toolLayer`: the Shape and Connector tools render a
  transparent screen-space layer inside the board surface that owns every press (TC-28: no
  object moves), while wheel/pinch still navigate. Selection handles are hidden while a
  creating tool is active. The Shape kind menu (Rectangle / Ellipse / Diamond, `role="group"`
  "Shape kind", `aria-pressed`) is shown next to the Shape button while the Shape tool is
  active; picking a kind keeps the tool. Buttons are "Shape (S)" and "Connector (L)".
- **Shift squares before the minimum-size check.** `createShape` squares a Shift drag (larger
  side, anchored at the press point `at`) and only then applies the click rule, so a thin Shift
  drag still gives a square of the dragged length.
- **Arrow picking.** An arrow's DOM takes no pointer events. With the Select tool the board asks
  the registry, in the capture phase, for the topmost object whose `hitTest` matches the press
  (`hitTest(obj, p, zoom)`: bounds for boxes, `distanceToPolyline <= CONNECTOR_HIT_TOLERANCE_PX /
  zoom` for arrows, `pickByHitTest: true`). If that is an arrow, the generic gesture starts for it;
  otherwise the press goes to the objects' DOM as before. A double-click on an arrow's line does
  not create a note. A lone selected arrow shows its own end handles instead of the selection box
  (`ownSelection`).
- **Snapshot of arrows.** `ConnectorSnap` also carries `ends` (the resolved points) besides the
  stored `from`/`to`; its box is derived from them. `objectRects(doc)` gives the rects arrows
  attach to. Arrows cannot attach to arrows.
- **Moving arrows.** Only free ends move. The move gesture uses a new registry hook
  `applyMove(doc, start, dx, dy)` (from the snapshot at gesture start, so frames never drift);
  `moveObjects` (nudges) moves an arrow's free ends by the offset of its derived box.
  `resizeObjects` skips arrows; in a group resize they move with the group.
- **Orphaned ends.** `createConnector` keeps an end attached to an object that is already gone
  (drawn at its fallback). `setConnectorEndpoint` turns such an end into a free end at its
  fallback when it writes the other end (the design's "next local write normalises").
- **Label layout.** The label is HTML over the SVG outline (the objects are HTML elements in the
  world layer) rather than a `foreignObject`; the effect is the same. It is centred with a small
  inset for ellipses/diamonds and 16 px world font (`SHAPE_LABEL_FONT_PX`, added to config). A
  label taller than its shape overflows evenly above and below (stays centred) instead of being
  clipped. While editing, a hidden copy of the text sizes the box the textarea covers, so the
  caret stays centred too. The editor is the textbox "Shape label"; shapes are `role="group"`
  with `aria-roledescription` = kind name and the label (or kind name) as their name; arrows are
  groups named "Arrow" with handles "Arrow start" / "Arrow end".
- **Shape toolbar.** Swatch names follow the design's `<colour> fill` / `<colour> outline` with
  the palette keys, so "no fill" is `none fill` (its tooltip says "No fill"). The toolbar also has
  "Delete shape", like the other single-object toolbars.
- **TC-27 race.** Sam's outgoing WebSocket frames are held back with `page.routeWebSocket`
  (order kept) so the delete reaches the room after Dana's arrow; both screens then draw the
  arrow's end at its fallback. `openParticipants` gained an optional `beforeOpen(name, page)`.
- **E2E browsers.** TC-23 runs in every configured browser, the rest in Chromium only (design).
  Firefox still cannot start in this environment; runs used `E2E_BROWSERS=chromium,webkit`.
- **Red-phase commits skipped** (tasks 7, 9), as in earlier stories: one story commit.

## Story 11 — Sketch freehand with a pen

- **Picking strokes.** Strokes reuse story 10's hit-test picking (`pickByHitTest: true`): the
  stroke's DOM takes no pointer events and the board picks it in the capture phase when a press
  is within `max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom)` of its line. A press elsewhere
  in its box falls through to the object underneath (or empty board). A selected stroke uses the
  generic selection box and handles (aspect-locked, `STROKE_MIN_SIZE_WORLD`).
- **Pen tool routing.** The Pen uses the `toolLayer` from story 10: a transparent layer over the
  board that owns every press (so a pen drag never pans or moves an object), while wheel/pinch
  still navigate. `pen` joined `MODE_TOOLS`; unlike Shape/Connector it never calls
  `toolCreated`, so it stays active until Escape or another tool. Button: "Pen (P)".
- **Pen toolbar.** Shown next to the Pen button while it is active (like the Shape kind menu), as
  `role="group"` "Pen options": swatches named `<colour> pen` with the `PEN_COLORS` keys
  (`black pen` … `purple pen`) and Thin / Medium / Thick, all with `aria-pressed`.
- **Options memory.** `usePenOptions` keeps colour/thickness in a module-level store, so the
  choice survives switching tools and opening another board in the same tab, and resets on
  reload (never stored).
- **Preview.** The in-progress line is a screen-space SVG path in the tool layer, redrawn in a
  `requestAnimationFrame` callback with `flushSync`, so the DOM changes within the frame after
  the pointer moved. It is never written to the Y.Doc (others cannot see it). Coalesced events
  are used when the browser provides them; exact duplicate points are skipped.
- **Dots.** A press/release that never moves `DRAG_THRESHOLD_PX` from the press point commits a
  single point (a thickness-square box; rendered as a zero-length round-capped path).
- **Long strokes.** When the current part reaches `STROKE_MAX_POINTS` recorded points it is
  simplified and committed, and drawing continues from its last point. A final part consisting
  of just that join point (release right after a split) is not committed as a separate dot.
- **Leaving the Pen mid-drag** (Escape or another tool while the button is held) keeps the
  stroke drawn so far, like an interrupted drag.
- **Stroke box and scaling.** The box is the points' bounds padded by half the thickness; stored
  points are relative to it with `baseWidth/baseHeight`. Resizing scales the points (padding
  included) but never the line width. Malformed stored points read as no points (nothing drawn).
- **Accessibility.** The stroke element is `role="img"` named "Drawing" (focusable; focus selects
  it, as for arrows); the SVG inside is `aria-hidden`, so the name is announced once rather than
  also on the `path`.
- **Round cursor.** A CSS cursor image (SVG data URL) of diameter thickness × zoom (clamped to
  3–120 px so it stays visible and within browser cursor limits); `data-cursor-size` exposes the
  unclamped size for tests.
- **E2E.** Synthetic mouse moves cost ~0.1 s each on this machine (panning too), so recorded
  paths are replayed at every 2nd/3rd point and pen tests allow 90 s. TC-17 checks the preview
  against frames: in every frame that follows pointer moves the preview path differs from the
  previous frame. Headless WebKit throttles animation frames heavily (≈1 fps while driven), so
  the check counts only frames that actually ran. TC-17 runs in every configured browser, the
  rest in Chromium only (design). Firefox still cannot start here; runs used
  `E2E_BROWSERS=chromium,webkit`.
- **Red-phase commits skipped** (task 1), as in earlier stories: one story commit.

## Story 12 — Drop images onto the board

- **Unknown `/api/*` addresses are 404.** URL parsing normalises `/api/assets/../x` to `/api/x`,
  which used to fall through to the app page (SPA fallback, 200). Any `/api/` path the Worker
  does not route now answers 404 JSON, so TC-16's `../x` case is a 404 and API typos never
  return HTML. The upload route is matched before story 5's `/api/boards/:id`.
- **Upload body.** Checks run in the design's order (id → `exists()` → `Content-Length` →
  body → sniff → put). The body is read as a stream and abandoned once it passes
  IMAGE_MAX_BYTES, so an upload without a `Content-Length` is never buffered beyond the limit.
  Served images also get `Content-Length` and `ETag`. Other methods: 405 with `Allow`.
- **Service refusals remove the placeholder.** If the server answers 413 or 415 (the browser
  checks normally catch these first), the client shows the same size/type message and removes
  the placeholder with UPLOAD_ORIGIN (so no undo step is added), as the design says ("nothing is
  stored or added"). Every other failure (404, 500, network error, abort) marks it `failed`.
- **Count limit counts supported files.** `validateFiles` refuses type and size first and then
  keeps the first IMAGE_MAX_FILES_PER_ADD of the remaining files (PRD: "more than 20 supported
  files"). A file whose extension claims an image but whose content does not decode
  (`createImageBitmap` rejects, e.g. a renamed PDF) gets the type message.
- **Hook API additions.** `useImageInsert` also takes `viewport` (for the view centre),
  `canEdit`, `notify` (toast), `boundary` (story 8 undo step around the placeholders) and
  `onPickerClose`, and also returns `onDragEnter`/`onDragLeave`, `dragging` (drop highlight).
  `camera` may be a getter. `openPicker()` returns `false` when it showed the offline message
  instead of opening the picker. The paste listener sits on `window`; pastes with focus in a
  field/editor are left alone.
- **Image tool.** `image` joined `MODE_TOOLS`; it is active (button pressed) only while the
  picker is open and returns to Select on `change` or `cancel`. `App` turns "set tool image"
  (button or I) into `openPicker()`. The picker is a hidden `<input type=file multiple
  accept=…>` appended to `<body>` (removed on unmount).
- **Unfinished clock.** Instead of a 30-second interval, each uploading image sets one timer for
  the moment it becomes stale (uploadStartedAt + IMAGE_UPLOAD_STALE_MS + 1 ms), which shows
  "Image upload didn't finish" at that moment without polling.
- **Undo/redo of an insertion (design's open question).** Confirmed: status changes with the
  untracked UPLOAD_ORIGIN are not undo steps; undo removes all placeholders of one add in one
  step, and redo brings them back *with* their later `ready` state and asset key (Yjs restores
  the map's latest content). Asserted in TC-05.
- **Image board context.** Image objects get identity, progress, Retry and Remove through
  `ImageContext` (the generic registry props have no room for them); `ImageEntry` adapts. The
  uploader is recognised by the tab's anonymous identity (story 6 is not in this build), so
  after a reload the uploader sees a failed image as others do ("Image unavailable"); Remove
  on an unfinished image is available to everyone. Remove is its own undo step.
- **Accessibility.** Image objects are `role="group"` named "Image"; a ready image is an
  `<img alt="Image">`. The toast region is always mounted, `role="status"` `aria-live="polite"`.
  The Image button is "Image (I)". Upload progress is a `progressbar` "Upload progress".
- **Fixtures.** Generated with ImageMagick (`tests/fixtures/images/`): PNG 1440×900, JPEG
  4032×3024 (plasma, ~1.2 MB rather than ~3 MB to keep the repository small), 3-frame GIF, WebP
  640×480, SVG with a script, a PDF named `.png` and a truncated PNG. The 10 MB
  and 10 MB + 1 files are generated in the tests (a real JPEG padded after its end). Integration
  tests import fixtures with Vite's `?inline` (declared in `tests/integration/image-fixtures.d.ts`).
- **E2E.** TC-25 holds Leo's uploads for 1.5 s with `page.route` so Sam's "Uploading…"
  placeholders are observable; the logged drop-to-visible times therefore include that delay
  (reported, not asserted). TC-26 runs in every configured browser, the rest in Chromium only
  (design). Firefox still cannot start here; runs used `E2E_BROWSERS=chromium,webkit`.
- **Red-phase commits skipped** (tasks 1, 2), as in earlier stories: one story commit.
