# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec was silent or ambiguous:

- **Camera wiring.** The design gives `BoardViewport` only a `children` prop, yet `App.tsx`
  must also feed `ZoomControls` and `NavigationHint` from `useCamera`. `App` owns
  `useCamera` and passes it to `BoardViewport` through `CameraContext`
  (`src/client/canvas/useCamera.ts`), along with a callback for the ResizeObserver size.
- **Extra `useCamera` members.** Besides the contract, the hook exposes `zoomAt(point, factor)`
  (used for Safari `gesturechange` scale ratios) and `setCamera(cam)` (used only by the
  test hook).
- **Initial view** is the same as Reset view: 100%, with the board origin centred. Pressing
  Reset view when already there is a no-op and does not dismiss the hint.
- **Grid level of detail.** At low zoom a 24-unit grid would be 2.4 px apart and read as a grey
  haze. The spacing doubles (48, 96, …) until dots are at least `GRID_MIN_SCREEN_SPACING_PX`
  (8 px) apart. Dots are always a subset of the base grid, so they stay attached to the board.
  At zoom ≥ 1/3 the spacing is exactly `GRID_SPACING_WORLD * zoom`.
- **Additional named settings** in `src/shared/config.ts`: `ZOOM_STEP_SNAP_EPSILON`, `PERCENT`,
  `WHEEL_LINE_HEIGHT_PX`, `GRID_MIN_SCREEN_SPACING_PX`.
- **Keyboard shortcuts** listen on `window`, which in this story means "while the board is
  focused" because the whole page is the board. They are ignored when focus is in an editable
  element (for later stories' text inputs). `+`/`_` and numpad keys are accepted as
  aliases for `=`/`-`.
- **Test hook.** `window.__vidi6` (`setCamera`, `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'`. `npm run build:test` builds that mode for e2e; the
  production `npm run build` does not contain it (checked via grep).
- **Camera readout for tests.** The viewport element carries `data-camera-x/y/zoom` and
  `data-state="idle|panning"` attributes so component and e2e tests can assert state.
- **E2E browsers.** `playwright.config.ts` defines chromium, firefox and webkit projects but
  only enables the ones installed locally. In this environment only Chromium is installed, so
  e2e ran in Chromium only.
- **Commits.** The whole story went into a single commit (per the session instructions)
  instead of a separate red-phase commit for task 1.
- **Not covered by automated tests:** Safari pinch in a real browser, trackpad hardware
  differences, and touch input. These match the design's "Not covered" list. The manual
  Chrome/Safari check in task 3 was replaced by automated Chromium e2e plus a visual screenshot check.

## Story 2 — Capture ideas on sticky notes and rearrange them

- **Stable DOM order, z-index stacking.** Notes are rendered in id order with `z-index` taken
  from the `(z, id)` snapshot order. Re-ordering DOM nodes on `bringToFront` would move the
  element that holds the drag's pointer capture, which browsers treat as losing capture.
- **Note toolbar placement.** `NoteToolbar` is rendered by `App` in the world layer *after* all
  notes (an anchor at the note's top-centre with `scale(1 / zoom)`), not inside `StickyNote`,
  so a later-stacked note can never cover it and it keeps screen size at any zoom.
  `StickyNote` reports Dragging through an extra optional `onDragChange` prop so the toolbar
  hides while dragging; it also takes an optional `zIndex` prop.
- **`createSticky` with non-finite coordinates** returns `''` (falsy) instead of an id, since the
  contract's return type is `string`. No transaction is opened.
- **`moveObject` to the current position** returns `false` with no update (a no-op, like
  `bringToFront` on the topmost note). `setStickyColor` to the current colour likewise.
- **`bringToFront` with a tie** for topmost counts as "not topmost", so it raises the note.
- **Length limit while typing in the middle.** Beyond `clampToLimit` (required by the
  contract), the editor uses `limitEdit(prev, next)`: only the newly inserted characters beyond
  1,000 are dropped, so typing into the middle of a full note never pushes text off its end.
  For a paste into an empty note it is identical to `clampToLimit` (caret at end).
- **Surrogate pairs.** `clampToLimit` and `applyTextDiff` never split an emoji pair; the limit
  counts UTF-16 code units (what the textarea reports).
- **Keyboard.** Enter/Delete/Backspace act on the selected note, or on a note focused with Tab
  (so notes are reachable with Tab and editable with Enter). They are ignored while any note is
  being edited, when focus is in a text field or on a button, and with Ctrl/Cmd/Alt held.
- **Edit end.** Escape returns focus to the note element (still selected). Blur only flushes the
  pending value; editing ends on Escape or a pointerdown outside the note, per the design.
- **Vertical centring.** Display text is centred with flex auto margins, which fall back to
  top-aligned when the text overflows so clipping only happens at the bottom (under the fade).
  The textarea gets a matching top padding so text does not jump when editing starts.
- **Extra named settings:** `STICKY_PADDING_WORLD` (16), `BOARD_SCHEMA_VERSION` (1).
- **Test hook.** `window.__vidi6.doc` (the board `Y.Doc`) was added for component and e2e tests
  (TC-37 deletes through the model while dragging/editing). Still test-mode only; the
  production build was re-checked with grep.
- **Notes carry `data-x/y/z/color/state/selected/editing`** attributes for test assertions.
- **E2E browsers:** only Chromium is installed here, so e2e ran in Chromium only.
- **Manual checks** from tasks 4/5 (IME on macOS, trackpad feel) were not run by hand; IME is
  covered by a jsdom composition test and drag accuracy at 50%/200% by Chromium e2e.
- **Commits.** The whole story went into a single commit (per the session instructions) rather
  than separate test-first commits for tasks 1 and 3.

## Story 3 — See other people's edits appear live on the same board

- **Integration toolchain.** `@cloudflare/vitest-pool-workers` (latest 0.22) supports only
  vitest ^4.1, and fails to start under the app's vitest 5. The integration suite therefore has
  its own toolchain in `tests/integration/package.json` (vitest 4 + the pool), installed by the
  root `postinstall`, with its own `tests/integration/vitest.config.ts` (root = that directory so
  `vitest` resolves to v4). `npm run test:integration` builds the client first (the Worker's
  assets binding needs `dist/client`). It is not a project inside the root `vitest.config.ts`
  as the task suggests.
- **Compatibility date in integration.** The pool's bundled workerd supports dates up to
  2026-08-22, older than `wrangler.jsonc`'s 2026-09-17, so the integration config overrides
  `compatibilityDate` for tests only. `wrangler dev` (e2e) uses the real date.
- **Worker typecheck.** Worker code (`src/worker`, `tests/integration`) is checked by
  `tsconfig.worker.json` with `@cloudflare/workers-types` (no DOM). `npm run typecheck` runs both configs.
- **`binaryType = 'arraybuffer'`** is set on the room's server sockets: with the current
  compatibility date workerd delivers binary frames as `Blob` by default.
- **Invalid updates.** `y-protocols`' `readSyncMessage` swallows `applyUpdate` errors (it only
  logs them), so the room handles SyncStep1 itself and applies SyncStep2/Update with
  `Y.applyUpdate` directly. That way an invalid Yjs update closes the sender with 1003 (TC-15).
  `decodeMessage` also rejects a length prefix that runs past the end of the frame, unknown sync
  subtypes, and trailing bytes. For sync frames `payload` is the body after the message type.
- **`run_worker_first: ["/api/*"]`** in `wrangler.jsonc`, so room requests never hit the SPA
  fallback.
- **Routing.** `/b/:boardId` with a valid id opens that board. Any other address, including `/`
  and `/b/<invalid id>`, is replaced (history `replaceState`) with `/b/<newBoardId()>`. Story 5
  replaces this.
- **Remote typing while editing.** Story 2's editor read the `Y.Text` only when editing started,
  so its next local diff would have deleted text other people typed meanwhile. The editor now
  observes the `Y.Text`. It applies remote changes to the textarea and moves the caret and selection
  with them (`transformIndex`). During an IME composition, remote changes are held back; when the
  composition ends, they are merged and the composed edit is rebased onto them.
- **Delete during edit/drag** relies on story 2's App effect (a vanished selected note clears
  selection/editing; an unmounted `StickyNote` ends its drag silently). This is not a new
  `useSelection` hook.
- **Connection-state mapping.** Failures before the first sync keep "Connecting…". y-websocket
  emits `disconnected` only for a socket that had opened. `connectBoard` takes an optional
  4th argument (provider factory) so component tests can drive a fake provider. Component tests
  replace `WebSocket` with an inert stub (`tests/component/setup.ts`), so App-level tests never
  touch the network.
- **Test hooks (test mode only).** `window.__vidi6.connectionState` and
  `window.__vidi6Unmount()` (used by the TC-29 teardown check). The production build was
  re-checked with grep.
- **E2E latency** is measured in the pages. An init script records when each note property
  first shows a value on each screen, and latency is receiver time minus sender time. It is logged
  against `LIVE_UPDATE_LATENCY_BUDGET_MS` and never asserted. The zoom-label e2e helper and one
  component test now select the status role by name (`Zoom level`), because the connection badge
  is also `role="status"`.
- **Nightly.** TC-29/TC-30 are tagged `@nightly`. They run with `npm run test:e2e:nightly` and
  are excluded from `npm run test:e2e`. The 45 s idle and 60 s soak durations are test-local
  constants taken from the design. TC-30 participants edit only their own notes, each in its own
  screen band. This matches the design's "two writers different notes" class and keeps UI clicks
  deterministic.
- **E2E browsers:** only Chromium is installed here, so e2e (including TC-22/TC-23) ran in
  Chromium only.
- **Commits.** The whole story went into a single commit, per the session instructions.

## Story 4 — Return to a board and find everything as it was left

- **Per-row limit.** Cloudflare documents a 2 MB maximum for a SQLite string, BLOB or row in
  Durable Objects. `SNAPSHOT_CHUNK_BYTES` (512 KB) is well under that limit. This was checked
  against the documented limit as I remember it; I did not re-check it online.
- **One damaged log row.** A Yjs client's updates form a clock chain. If one row is quarantined,
  every later update from that writer would stay pending, and most of the board would
  disappear. After replaying the log, `BoardStore.load` fills each such clock gap with a GC
  (deleted) placeholder, so later changes still integrate and only the damaged change is
  missing (persist.partial_damage). Stored rows are fully decoded (`Y.decodeUpdate`) before they
  are applied, so a damaged row is rejected before anything is integrated. A snapshot that
  still leaves unresolved references after it is applied also counts as `snapshot-unreadable`.
- **Room lifecycle.** `src/worker/room-state.ts` has `nextRoomState(state, event)`, with states
  loading / ready / compacting / storage-failed / hibernated / load-failed. `BoardRoom` drives its
  state through it. Its `state` getter exposes the contract's `RoomState` (plus `loading`).
  The room cannot observe hibernation itself: waking simply runs the constructor again
  (loading).
- **Extra members.** `BoardStore.compact(doc)` forces a compaction, which `compactIfNeeded`
  uses and which the test hook and tests call. `BoardStore.needsCompaction()` and an optional
  `{ chunkBytes }` constructor option exist so TC-08 can force several chunks, because a 2,000-note
  board encodes below 512 KB. `BoardRoom.createStore` and `loadAttempts` are test seams used
  through `runInDurableObject`.
- **Restarts in integration tests** use `evictDurableObject` from the pool.
  `{ webSockets: 'close' }` stands for "everyone left, then restart". The default mode
  (hibernate) is used for TC-18: sockets stay open, the object is rebuilt from storage, and
  broadcasts reach those sockets through `ctx.getWebSockets()`. TC-16 waits a real
  `LOAD_RETRY_MIN_INTERVAL_MS`.
- **Test hooks.** `src/worker/test-hooks.ts` serves `POST /__test/boards/:id/compact`,
  `/corrupt-snapshot` and `/repair`. `compact` was added because the TC-24 workflow compacts
  first. `corrupt-snapshot` also closes the room's sockets and reloads the room (it simulates a
  restart). The routes are gated at runtime by `env.TEST_HOOKS === '1'`, not at compile time.
  Only the e2e `wrangler dev` command lines pass `--var TEST_HOOKS:1`; `wrangler.jsonc` never
  sets it. An integration test checks that without the variable the path is not routed to a
  room. `"/__test/*"` was added to `run_worker_first` so that POSTs reach the Worker. In
  production they fall through to the static client.
- **E2E process control.** `tests/e2e/persistence.spec.ts` runs in its own Playwright project,
  `persistence` (Chromium). It is excluded from the browser projects. Each test starts
  `wrangler dev --persist-to <tmp>` on free ports through `tests/e2e/helpers/wrangler-process.ts`
  and restarts it by SIGKILLing the whole process group, like a crash. TC-19 restarts right away
  instead of waiting the PRD's 5 minutes: a process restart is the stronger check. Boards for
  TC-21 and TC-24 are seeded by a Node y-protocols client (`tests/e2e/helpers/seed.ts`).
- **Large-board load time.** TC-21 first took about 7 s. Each note's font fitting forces
  synchronous reflows, and with 2,000 notes each reflow laid out the whole board. Adding
  `contain: size layout style` to `.sticky-note` (fixed 200×200) makes each note its own layout
  boundary. After that, a cold open of 2,000 notes renders in about 1 s locally. The time is
  logged against `BOARD_LOAD_BUDGET_MS`, not asserted.
- **Client state.** `connectBoard` also listens to the provider's `connection-close`.
  4500 → `load_failed`, which stays through retries until a sync succeeds → `connected`.
  Any other code, including 1011 and 1003, → `reconnecting`, or stays `connecting` before the
  first sync. y-websocket treats 4500 as a transient code (only 4400–4499 is permanent), so it
  keeps retrying with story 3's backoff.
- **Edit lock.** While `!canEdit`, the Sticky note button is disabled. Double-click create,
  Delete/Backspace/Enter, drag and text editing do nothing, and the note toolbar (colour and
  delete) is hidden. Selecting a note still works, since it changes nothing. An edit in progress
  ends if the board becomes unloadable.
- **Opening a board writes one row.** Each browser's `initDoc` sets `meta.schemaVersion`. That
  is a real document change, so the first real client to open a never-edited board stores one
  small update. TC-25 (no rows just from opening) is checked at the storage/room level, where
  no client writes anything.
- **E2E browsers:** only Chromium is installed here, so e2e ran in Chromium only.
- **Commits.** The whole story went into a single commit, per the session instructions.

## Story 5 — Share a board with others using a link

- **Board UI moved.** The stories 1–4 board moved from `App.tsx` to `src/client/board/Board.tsx`
  (`Board({ boardId, children })`). `App.tsx` now only routes. It still re-exports `canEdit`
  for existing tests. `BoardPage` renders `Board` with `SharePanel` as its child.
- **Obsolete story 3 behaviour removed.** The design deletes the `/` → random-id redirect, so the
  component test "redirects / to /b/<new board id>" was replaced: `renderApp(boardId)` now
  renders `Board` directly, and routing is covered by `tests/component/pages.test.tsx`. Story 3's
  integration TC-04 now expects 404 instead of 400 for malformed room ids, as the design's HTTP
  contract requires.
- **Existing tests create boards first.** Connecting no longer creates a board. Integration
  tests use `createBoardId()` (`POST /api/boards`, in `ws-client.ts`), and e2e helpers use
  `tests/e2e/helpers/server.ts` `createBoardId(baseURL)`. `board-store.test.ts` still uses raw
  ids because it only touches storage.
- **Existence rule details.** A board with tables but no `created_at` and no
  `updates`/`snapshot_chunks` rows does not exist. That covers a story 3/4 room that was only
  opened, which writes tables but no rows. Existence is checked with a plain `BoardStore` on the
  object's storage, not the room's `createStore` test seam, so injected load failures still
  report `load-failed` (4500) and not 404. `BoardStore.compact()` also migrates lazily, like
  `append()`.
- **`nextBoardPageState`** takes an optional fourth `boardId` argument so the `ready` state can
  carry the id. The contract's three-argument call still type-checks. Retry delays:
  `BOARD_CHECK_RETRY_BASE_MS × 2^(attempt−1)`, capped at `RECONNECT_MAX_BACKOFF_MS`.
- **Other methods.** `GET`/`HEAD` on `/api/boards/:id` are allowed; other methods get 405, as on
  `/api/boards`. 405 responses carry an `Allow` header.
- **UI details not fixed by the PRD.** The home link on Board not found reads "Go to the vidi6
  home page". The link field is labelled "Board link". Opening the Share panel focuses Copy
  link. The tick in "✓ Link copied" is `aria-hidden`, so the button's name is "Link copied".
  The share note is the dialog's description.
- **Legacy seeding (TC-31).** A new TEST_HOOKS-only route, `POST /__test/boards/:id/seed-legacy`
  (body = one Yjs update), writes story 4's tables plus one `updates` row without
  `created_at`, then reloads the room.
- **Compatibility date.** The existing `2026-09-17` already supports Durable Object RPC, so it
  was left unchanged. The integration pool still overrides it to `2026-08-22`, which also
  supports RPC.
- **E2E browsers:** only Chromium is installed here. TC-26 and TC-31 are skipped on other
  browsers by design; TC-27 and TC-29 could not be run on Firefox or WebKit.

## Story 7 — Select, move, resize and delete several objects at once

- **Board lives in `Board.tsx`.** The design names `App.tsx` for wiring. Since story 5 the board
  is `src/client/board/Board.tsx`, so the overlay, bar, keys and marquee are wired there. The old
  Delete/Enter handler moved from `Board.tsx` into `useBoardKeys`.
- **Snapshots.** `ObjectSnapshot` is the common shape (`id, type, x, y, width, height, z,
  createdAt`). `StickySnapshot` extends it. `snapshot(doc)` still returns only stickies (story 2
  contract, used by existing tests). The new `objectsSnapshot(doc)` returns every known-type
  object, and the board renders from it. The model's "known types" start with `sticky`.
  `registerObjectType` (client registry) also calls the new `registerModelType`, so a registered
  type (for example the test-only `testbox`) shows up in `objectsSnapshot`, `allObjectIds` and
  `objectsInRect`. Unknown types are still skipped (TC-08).
- **New stickies store `width`/`height`** (200) explicitly. Notes from before this story keep
  implicit 200×200 until their first resize writes both fields (TC-10).
- **Bigger notes, bigger text.** A sticky's content is laid out at the base size
  (STICKY_SIZE_WORLD) and scaled by `width / STICKY_SIZE_WORLD`. Font fitting therefore never
  depends on size, and a note enlarged for emphasis shows larger text (PRD pain point 3).
- **Selection hides deleted ids at once.** `useSelection(snapshot)` exposes only ids present in
  the snapshot being rendered, and it also dispatches `prune` on every snapshot change. This is
  how "actions referring to absent ids are ignored" is met. A reducer that knows the snapshot
  would ignore `startEdit` for a note created in the same event.
- **`useSelection().endEdit()` takes no argument** (per contract). The editor's
  `onEnd('unselected')` maps to `clear()`.
- **Gesture API extras.** `useTransformGesture` also returns `phase` and `activeIds`, which drive
  each object's `data-state` (`idle|pressed|dragging`) and hide the bar while moving or resizing.
  Pointer listeners go on the pressed element (with pointer capture), not on React props.
- **Click semantics.** Pressing an unselected object selects only it immediately. Pressing a
  selected object keeps the selection (so a drag moves the group), and releasing without a drag
  then selects only that object. Shift+press toggles. When the toggle adds the object, a drag
  moves the whole selection. When it removes it, nothing is dragged.
- **Clamping.** `clampScale` takes an optional 5th argument `uniform` (default
  `scale.x === scale.y`). The gesture passes the aspect flag. An object that is already beyond a
  limit (for example a tiny legacy object) is never pushed further past it, and never forced back.
  Non-resizable types in a mixed selection keep their size and follow the layout. `resizeRect`
  never flips (sizes clamp at 0), and an edge handle with aspect lock scales the other axis about
  its centre.
- **Extra geometry export:** `scaleRectFrom(start, handle, scale)` (the anchored box for a
  clamped scale) and `HANDLES`.
- **Overlay.** `BoardViewport` got two optional props: `marquee` (Shift+pointerdown on empty
  space; `data-state="marquee"`) and `overlay` (a screen-space layer above the world). The
  bounding box, handles (`role="button"`, `aria-label="Resize top-left"` … `"Resize left"`) and
  the selection bar / note toolbar render there. The note toolbar therefore now sits above the
  selection box in screen space, not in the world layer. Selected objects keep a
  `data-selected` outline that is 1.5 screen px at any zoom (`--zoom` CSS variable).
- **Handles and bar are hidden** while a note is being edited and when the board failed to load.
  Selection still works for viewing then. For a single selected non-sticky object no bar is shown.
- **Announcements.** A persistent visually hidden `aria-live="polite"` region
  (`data-testid="selection-announcer"`) reads "N selected" (empty when nothing is selected). It is
  not `role="status"`, so existing `getByRole('status')` queries still match only one element.
- **Keys.** Ctrl/Cmd+A, Escape, arrows, Delete/Backspace and Enter are ignored while editing or
  in text fields. Unlike story 2, Delete/Backspace also act when focus is on a toolbar button,
  such as after clicking a swatch. Enter on a button is still left to the button. A note focused
  with Tab but not selected is still the target of Enter/Delete/arrows. Escape during a marquee
  cancels only the marquee (capture-phase listener).
- **LoadFailure test** now also spies on the new group mutations and checks that arrow keys and
  handles do nothing (this adds coverage; nothing was weakened).
- **Fixtures.** `tests/fixtures/testbox.tsx` registers the test-only `testbox` type (resizable,
  not aspect-locked, minSize 10). `selectionBoard()` in `tests/fixtures/boards.ts` is the 20-note,
  two-cluster retro board used by `tests/e2e/selection.spec.ts`.
- **Stories 6/8 hooks left out.** There is no presence publishing of selected ids. The
  `onGestureStart/End` options exist (story 8 will use them), but the board passes none.
- **E2E browsers:** only Chromium is installed here, so TC-32 did not run on Firefox or WebKit.
- **Commits.** The whole story went into a single commit, per the session instructions.

## Story 8 — Undo and redo my own changes without undoing anyone else's

- **Controller lives in `Board.tsx`.** The design names `App.tsx`. Since story 5 the board is
  `src/client/board/Board.tsx`, so that is where one controller per board doc is created (in an
  effect, destroyed on doc change or unmount). Until the effect runs, a no-history `NO_UNDO`
  controller stands in. The controller reaches the sticky text editor through `UndoContext`
  (`useUndo.ts`), so object components need no new props.
- **Capture timing is done by the controller, not by `Y.UndoManager`.** lib0 binds
  `getUnixTime = Date.now` at import, so the manager's own capture timer cannot be driven by a
  fake clock, and TC-13's exact boundary could not be tested. The manager gets an effectively
  infinite `captureTimeout`. The controller's `captureTransaction` hook reads `Date.now()` for
  each LOCAL_ORIGIN transaction and calls `stopCapturing()` when the pause is
  ≥ `UNDO_CAPTURE_TIMEOUT_MS`. Behaviour is the same as the design's (pause of exactly 500 ms =
  new step; 499 ms = same step).
- **Exactly one step per undo.** `Y.UndoManager` skips a step whose inverse changes nothing
  (for example a move of a note someone else deleted) and goes on to undo the *next* step. That
  would break the PRD's "nothing visible happens; the next undo continues normally". The
  controller hides the older steps while popping, so the no-op step is the one consumed. Change
  notifications are sent once, after the stack is restored.
- **Undo inside the note editor is limited to that note's typing.** Ctrl/Cmd+Z (and
  Ctrl/Cmd+Shift+Z, Ctrl+Y) in the textarea always prevent the native textarea undo. They act
  only when the next undo/redo step changed nothing but this note's `Y.Text`. The controller
  tags each stack item with the shared types it changed; this is the extra
  `UndoController.nextStepOnlyIn(type, stack)`. So once the typing is undone, further Ctrl+Z
  presses while editing do nothing, and they never undo the note's creation from under the
  editor. After leaving the note (Escape/click outside), board undo continues through earlier
  actions.
- **Boundaries.** A boundary is placed at gesture start/end (including pointercancel), at edit
  start/end, and before and after each create, delete, colour change and arrow-key nudge (one
  nudge press = one step). `undo()`/`redo()` also close the capture window.
- **Shortcut details.** Ctrl+Y redoes; Cmd+Y does not (it is a browser shortcut on macOS and the
  PRD names only Ctrl+Y). With Alt held, the shortcuts are ignored. In a load-failed board they
  are ignored without `preventDefault`, and the buttons are disabled.
- **Buttons** sit in the left "Tools" toolbar below the Sticky note button, in a
  `role="group"` "History" with a divider. Tooltips are "Undo (Ctrl/Cmd+Z)" and
  "Redo (Ctrl/Cmd+Shift+Z)". They carry both `disabled` and `aria-disabled`.
- **Test seeding.** Component tests seed notes as non-local updates (as if loaded), so the
  history holds only the actions under test. E2E uses the new `undoBoard()` fixture (12 notes in
  varied colours and sizes, 8 in one cluster).
- **Out of scope** (stories 6, 16): no presence hooks. `addScope` exists for comments but is
  not used yet.
- **E2E browsers:** only Chromium is installed here, so e2e ran in Chromium only.
- **Commits.** The whole story went into a single commit, per the session instructions.

## Story 9 — Write free text anywhere on the board

- **Model reader hook.** `registerModelType(type, read?)` now takes an optional reader that adds
  a type's own fields to its snapshot. `src/shared/objects/text.ts` registers `text` with one, so
  `objectsSnapshot` returns `TextSnapshot`s (`text`, `size`, `widthMode`, plus `createdBy`).
  `board-model.ts` exports `getObject`, `maxZ` and `isFiniteNumber` for it. Old clients that don't
  know `text` still skip it (unknown type).
- **`createdBy`.** Story 6 (identity) is not in this build, so `createdBy` is a per-tab author id,
  `c_<Y.Doc clientID>` (`localAuthor(doc)` in `TextObject.tsx`).
- **Box and caret allowance.** Auto width = longest line + `TEXT_CARET_ALLOWANCE_WORLD` (4),
  capped at 600; text that has to wrap is exactly 600 wide. The allowance keeps the caret and
  sub-pixel differences from forcing a wrap in the DOM. A new text starts with the box of an empty
  line (4 × 26). Box values are rounded to 1/100 unit so re-measuring never writes noise. Extra
  named settings: `TEXT_CARET_ALLOWANCE_WORLD`, `TEXT_AVG_GLYPH_WIDTH_RATIO` (estimate fallback).
- **Measurer.** `createCanvasMeasurer` uses `OffscreenCanvas`, then `<canvas>`, else the estimate.
  jsdom is detected by user agent and uses the estimate (its canvas has no context and logs an
  error when asked). The board shares one measurer (`getTextMeasurer`); tests can swap it with
  `setTextMeasurer`. Rendering uses the DOM (`pre-wrap`) at the stored width, with the same font
  stack as the canvas, so the stored height and the rendered lines match (checked in e2e).
- **Resize.** `ObjectTypeSpec` gained `handles?: 'all' | 'horizontal'` and an optional
  `resize(doc, id, next, start, horizontalOnly)` hook. Text uses it: when every selected object is
  text, the dragged width becomes a fixed width (clamped to 40; a left-edge drag keeps the right
  edge) and y never changes. In mixed selections text only moves, and fixed-width text also
  scales its width. Height is always re-measured. Each frame is one transaction. `clampScale` has
  an optional `minHeights` argument, so text (height 0 minimum) never blocks a group from
  shrinking vertically. Shift (aspect lock) is ignored for text-only selections.
- **Undo and empty text.** `UndoController` gained `mergeNext()`, `topStep()` and
  `discardFrom(step)`.
  - A text I just created joins its first typing to the creation step. One undo removes the whole
    new text, so undo never leaves an invisible empty text behind. Ctrl/Cmd+Z inside the editor of
    such a text therefore removes it and ends the edit.
  - Abandoning a new text empty deletes it and removes its creation from my history (TC-20/TC-31:
    nothing to undo).
  - Existing text erased to nothing is deleted on edit end, merged into the last typing step, so
    one undo brings the text back.
- **Tool keys.** V/T/N work with or without Shift and are ignored with Ctrl/Cmd/Alt, while editing
  and in text fields. Escape with the Text tool active only returns to Select; it does not also
  clear the selection. With Text active, a press anywhere on the board, including on objects but
  not on the selection overlay (handles, toolbars), creates text. The create happens on pointerdown
  in the capture phase, with `preventDefault` so focus stays in the new editor.
- **Labels.** Tool buttons are "Select (V)", "Text (T)" and "Sticky note (N)" (tooltip
  "Sticky note (N) – or double-click the board"), and existing tests were updated to the new
  Sticky note name. The text toolbar is `role="toolbar"` "Text", with size buttons named "Size S" …
  "Size XL" (visible text S/M/L/XL, `aria-pressed`) and "Delete text". Text objects are
  `role="group"`, `aria-roledescription="text"`, named by their content ("Empty text" when blank),
  and tabbable. The editor textarea is named "Text".
- **Editor.** `TextEditor` is story 2's editor generalised (limit, font, width, `onInput`, undo,
  label/class/footer). `StickyTextEditor` wraps it with the counter. Outside clicks are now detected
  via `[data-object-id]`. `clampToLimit`/`applyTextDiff`/`diffText` moved to `src/shared/text-edit.ts`
  and `StickyText.ts` re-exports them.
- **Not done:** Firefox/WebKit are not installed here, so TC-26 ran in Chromium only.
- **Commits.** The whole story went into a single commit, per the session instructions.

## Story 10 — Draw shapes and connect them with arrows that follow when moved

- **Active tool hook.** `src/client/tools/useActiveTool.ts` holds the contract (`ToolId`, `TOOL_SHORTCUTS`,
  `useActiveTool` with `shapeKind`, `setShapeKind`, `toolCreated`). It takes an options object
  (`canEdit`, `select`) because selection lives in `Board` (story 7's `useSelection`), and `toolCreated`
  calls `select` (selection `click`). Story 9's `board/useTool.ts` is kept as a thin wrapper. Only
  select/text/shape/connector can be chosen; P/I/C (stories 11–17 tools not in this build) are ignored.
  The single-letter keys stay in `useBoardKeys` (which already ignores them while editing or typing in
  a field), now driven by `TOOL_SHORTCUTS`; there is no second window listener in the hook.
- **Toolbar.** "Shape (S)" and "Connector (L)" come after "Sticky note (N)". While the Shape tool is
  active a `role="group"` "Shape kind" menu to its right shows "Rectangle", "Ellipse", "Diamond"
  (`aria-pressed`). Shape and Connector are disabled on a board that failed to load, like Text.
- **Tools own the pointer.** `ShapeTool` and `ConnectorTool` render a full-viewport layer in the board's
  screen-space overlay, so presses over objects never select or move them (TC-28); wheel zoom still
  bubbles to the viewport. They take an extra `doc` prop (the contract lists none, and the board doc
  is not in a context). Escape unmounts the layer, which abandons an unfinished drag.
- **Shape creation.** `createShape` always receives the dragged world rect plus the press point `at`;
  a click is a 0×0 rect, so "rect null or below SHAPE_MIN_SIZE_WORLD" both give the standard size
  centred on the press. With Shift, the square is anchored at the drag origin and grows in the dragged
  direction (`shapeRect`, also used for the preview so it shows exactly what release creates).
- **Shape rendering.** The design mentions a `foreignObject`; the shape is instead an HTML box
  holding an SVG outline plus an HTML label box. The label box is the largest centred rectangle
  inside the outline (the whole rectangle, 1/√2 of an ellipse, half of a diamond). Its size comes from
  the object's size, so resizing re-wraps and re-centres the label. The label uses the story 9
  `TextEditor` (limit `SHAPE_LABEL_MAX_CHARS`, textbox "Shape label"). Extra settings:
  `SHAPE_LABEL_FONT_PX` (16), `SHAPE_LABEL_PADDING_WORLD` (8), `CONNECTOR_COLOR`, and the
  `FillColor`/`StrokeColor` types. Shapes are named "<Kind>" or "<Kind>: <label>".
- **Shape toolbar.** `role="toolbar"` "Shape": "No fill", "White fill" … "Grey fill", "Dark outline" …
  "Grey outline", and "Delete shape". A single selected arrow gets toolbar "Arrow" with "Delete arrow".
- **Model plumbing without import cycles.** `board-model.ts` must not import `objects/connector.ts`
  (connector imports board-model at load). So two hooks were added: `registerDeleteHook`, which
  `deleteObjects` runs inside its transaction before removing ids (connector.ts registers
  `detachConnectorsTo`; one update, one undo step), and a third `derive` argument to
  `registerModelType`. After sorting, `objectsSnapshot` runs `derive` with the stored rects of every
  non-derived object (`storedRects`), and connectors get their bbox and resolved `ends` there.
  `objectBounds` now keeps a zero width/height (a horizontal arrow's box is flat) instead of
  falling back to the sticky size.
- **Endpoint resolution.** Each attached end uses the side of its object facing the *other end's
  reference point*: the other object's centre, or the free point. `createConnector` and
  `setConnectorEndpoint` recompute an attached end's `fallback` from the target's current rect,
  and keep the caller's fallback only when the target is already gone (the delete race). A write to
  one end of an arrow whose other end is orphaned also turns the orphaned end into a free point at its
  fallback (the "Orphaned → Free" state).
- **Arrows cannot attach to arrows.** Registry specs got `attachable` (false for connectors) and
  `hitTest(obj, p, zoom?)`. The connector's `hitTest` is `distanceToPolyline ≤ CONNECTOR_HIT_TOLERANCE_PX / zoom`.
  In the browser the transparent hit stroke is exactly that wide (round caps), and the press handler
  re-checks it with the camera, so jsdom tests can exercise it too. `ObjectProps` gained optional
  `zoom` and `rects`.
- **Moving arrows with the selection.** Arrows store no position, so registry specs got an optional
  `transform` hook (`capture` + `apply(map)`). Move, group resize and arrow-key nudge map an arrow's
  *free* ends with the selection. Attached ends stay attached and follow their objects. An arrow is
  not resizable, and a lone selected arrow shows its two end handles ("Arrow start", "Arrow end")
  instead of the selection box.
- **Re-attach.** Handle drags hit-test the attachable rects (topmost first). Releasing on the object
  at the other end snaps back without writing. A press without movement changes nothing.
- **Connector tool details.** A drag is too short when the pointer moved less than
  `CONNECTOR_MIN_LENGTH_WORLD`, and the model also rejects resolved arrows shorter than that. While
  dragging, the object under the pointer (other than the start object) shows its dots with the
  attach side highlighted. The preview line is dashed.
- **E2E.** `openParticipant` got an optional `beforeOpen(page)` so TC-27 can install
  `page.routeWebSocket` on Sam's page and hold back Sam's outgoing frames (2.5 s) to force the
  delete race. TC-24 checks horizontal centring within 0.3 em, because a wrapped line's trailing space
  is part of its line box. Fixture: `tests/fixtures/checkout-flow.ts`, seeded via `seedBoard`.
- **E2E browsers:** only Chromium is installed here, so TC-23 did not run on Firefox or WebKit.
- **Commits.** The whole story went into a single commit, per the session instructions.
