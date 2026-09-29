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
