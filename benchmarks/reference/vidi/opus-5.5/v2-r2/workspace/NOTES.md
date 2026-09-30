# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec was open or self-contradictory:

- **Wiring BoardViewport to the camera.** The design gives `BoardViewport(props: { children })` but also has
  `App.tsx` wire `useCamera` to `ZoomControls`, and the viewport measures its own size. To keep that
  exact props contract, `App` calls `useCamera` and provides it (plus `setViewportSize`) through
  `BoardCameraContext` (`src/client/canvas/useCamera.ts`); `BoardViewport` reads it with `useBoardCamera()`.
- **Extra hook method.** `useCamera` also exposes `zoomAtPoint(p, factor)` for Safari `gesturechange`
  (scale ratio), which the listed hook methods had no way to express.
- **Initial view.** The camera starts as `resetCamera(window size)`: 100% with the board's starting
  point (marked by a small crosshair) at the centre, i.e. the same view Reset view returns to.
- **Named constants.** Added `WHEEL_LINE_HEIGHT_PX` (line-mode wheel deltas) to `src/shared/config.ts`;
  `PERCENT` and `ZOOM_STEP_SNAP_EPSILON` live in `camera.ts`. Page-mode wheel deltas use the board height.
- **Keyboard shortcuts** (Ctrl/Cmd + `=`/`+`, `-`, `0`, incl. numpad) are handled on `window` for the whole
  page (the page is the board), except while typing in an editable field.
- **Drag buttons.** Primary and middle mouse buttons both pan.
- **Test hook.** `window.__vidi6` (`setCamera`, `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'` (Vitest, and `npm run build:test` used by Playwright); production
  builds contain no trace of it. `setCamera` does not dismiss the navigation hint.
- **Red phase.** Task 1's failing-test phase was run locally against a throwing stub (22/22 failed with
  "not implemented"), but not committed separately: the session's instructions ask for a single story commit.
- **E2E browsers.** `playwright.config.ts` defines chromium, firefox and webkit projects, but skips
  Firefox/WebKit when their browser binaries are not installed. Only Chromium is installed on this
  machine, so e2e was verified in Chromium only.
- `npm run test:e2e` builds in test mode and serves `dist/client` with `wrangler dev` on port 8787.

## Story 2 — Capture ideas on sticky notes and rearrange them

- **`createSticky` return type.** The contract says it returns `string`, but TC-39 requires non-finite
  coordinates to be rejected with `false`; it is typed `string | false` (also `false` for an unknown colour).
  `at` is the note's **centre**; the model subtracts `STICKY_SIZE_WORLD / 2` (as tasks.md states).
- **No-op mutations return `false`** without a transaction: `moveObject` to the same position,
  `setStickyColor` to the current colour, `bringToFront` on a note already strictly on top (a note tied
  for the top z is still lifted, so the stacking is unambiguous).
- **Stacking without re-ordering the DOM.** Notes render in stable id order with `z-index: z`, which
  equals the `(z, id)` sort of `snapshot()`. Re-ordering DOM nodes on `bringToFront` would detach the
  dragged element and lose pointer capture mid-drag.
- **Note toolbar placement.** Because each note is its own stacking context, the floating `NoteToolbar`
  is rendered by `App` in a screen-space layer above the board (positioned with `worldToScreen`), not
  inside `StickyNote`; so it never scales with zoom and is never covered by other notes. `StickyNote`
  got an extra optional prop `onDragChange(dragging)` so the toolbar hides while dragging.
- **`BoardViewport`** got optional props `onEmptyDoubleClick(worldPoint)` and `onEmptyClick()` (a press
  and release on empty space moving less than `DRAG_THRESHOLD_PX`; panning keeps the selection).
- **Text limit when typing in the middle.** `clampToLimit` keeps the first 1,000 characters (contract).
  The editor additionally uses `clampEdit(prev, next)`, which drops the part of the *inserted* text that
  does not fit, so typing in the middle of a full note adds nothing instead of pushing the last character
  out. Lengths are UTF-16 code units; cuts never split a surrogate pair.
- **Text fit.** `fitFontSize` measures the display text element (always rendered, hidden while editing)
  against the inner text box (`STICKY_SIZE_WORLD − 2 × 16` padding); padding and line height are
  constants in `StickyText.ts` shared by the display element and the textarea. The editor textarea is
  vertically offset to match the centred display text.
- **Keyboard.** `App` handles Enter/Delete/Backspace on `window` for the selected note only when not
  editing, focus is not in an editable field, and no Ctrl/Cmd/Alt modifier is held; Enter on a focused
  button is left to the button. A note focused with Tab (`:focus-visible`) becomes selected, and Enter on
  a focused note edits it. Escape returns focus to the note.
- **Test support.** `App` accepts an optional `doc` prop (component tests pass a real `Y.Doc`), and the
  test-mode-only `window.__vidi6` hook gained `getNotes()` for e2e assertions (`installTestHooks` now
  merges hooks). Production builds still contain no trace of it.
- **Red phase.** As in story 1, test-first phases were not committed separately (single story commit).
- **Not verified manually:** IME (e.g. Japanese) input; the editor skips `input` during composition and
  commits on `compositionend`. E2E ran in Chromium only (Firefox/WebKit not installed).

## Story 3 — See other people's edits appear live on the same board

- **Vitest 4.1 instead of 5.** `@cloudflare/vitest-pool-workers` (0.22, the latest) only supports
  `vitest ^4.1` and fails to start under vitest 5, so the repo is on `vitest@^4.1.11` (unit and component
  suites are unchanged and pass). Revisit when the pool supports vitest 5.
- **Compatibility date 2026-08-22.** The workerd bundled with the Workers test pool rejects newer dates
  than 2026-08-22, so `wrangler.jsonc` uses that date (was 2026-09-01; nothing in the app depends on it).
- **`binaryType = 'arraybuffer'`.** With current compatibility dates workerd delivers binary WebSocket
  frames as `Blob` by default; the room (and the integration test client) set `arraybuffer`.
- **`assets.run_worker_first: ["/api/*"]`** so room connections always reach the Worker and never the
  SPA fallback. Any `/api/rooms/<anything>` that is not a valid id gets 400 (including nested paths).
- **Two tsconfigs.** `tsconfig.worker.json` type-checks `src/worker`, `src/shared` and
  `tests/integration` against `@cloudflare/workers-types` (no DOM); `npm run typecheck` runs both.
  `test:integration` runs `vite build` first because the assets binding needs `dist/client`.
- **Routing.** `main.tsx` resolves the board from `/b/:boardId` via `boardIdFromLocation()` (in `App.tsx`)
  and passes it to `<App boardId>`; `/` and any address that is not a valid `/b/<id>` are replaced
  (`history.replaceState`) with `/b/<newBoardId()>` until story 5. `App` without `boardId` (component
  tests) keeps a local, unconnected doc and shows no badge. `useBoardDoc(boardId, doc?)` now also
  returns the `connection` state.
- **Status mapping** lives in `trackConnectionState(providerEvents, onState)` (exported from
  `connectBoard.ts`) so component tests drive it with a fake emitter. The first sync after
  `connecting` → `connected` (no green badge on first load); failed first attempts stay "Connecting…".
- **Browser offline/online events.** `connectBoard` also drops the socket on `window` `offline` and
  reconnects immediately on `online`, so the amber badge appears at once instead of after y-websocket's
  30 s silence timeout, and recovery does not wait for the backoff.
- **Remote typing while editing.** Story 2's editor only read the Y.Text when editing started and wrote
  textarea-vs-Y.Text diffs, which would have erased someone else's simultaneous typing. The editor now
  observes non-local Y.Text changes, updates the textarea immediately and maps the caret/selection
  through the change (a remote insert exactly at the caret goes after it). Limitation: a remote change
  arriving mid-IME-composition updates the textarea and may cancel the composition (not verified).
  Concurrent typing can push a note past `STICKY_TEXT_MAX_CHARS`; the limit is only enforced per local edit.
- **Delete during edit/drag** relies on story 2's behaviour: `App` clears a selection whose note is gone
  (which also ends editing), and `StickyNote` unmounting ends a drag; no extra `useSelection` change.
- **Test hooks.** `window.__vidi6.connectionState` and `connectionStates` (history) are installed in
  test builds only. The e2e `zoomLabel` helper is now scoped to `.zoom-controls` (the badge is also a
  `role=status`), and `openBoard` waits for `connectionState === 'connected'`.
- **E2E.** `tests/e2e/live-collaboration.spec.ts` (TC-22–TC-28) runs in `npm run test:e2e`;
  `tests/e2e/live-collaboration.nightly.spec.ts` (TC-29, TC-30) runs only via `npm run test:e2e:nightly`
  (a `nightly` Playwright project that exists only when `VIDI6_NIGHTLY=1`). Latency is logged against
  `LIVE_UPDATE_LATENCY_BUDGET_MS`, never asserted. In TC-30, per-change latency is measured for creates
  and typed text (unique tokens, matched as an in-order subsequence because others may type into the same
  note); moves and recolours are only checked through final convergence. TC-29 checks "no reconnect"
  by counting WebSocket constructions in the page; destroy-on-unmount is covered by a component test,
  because nothing is observable in a page after its context is closed.
- **TC-18 restart** is simulated with a fresh board id (a fresh room instance), per the design.
- E2E ran in Chromium only (Firefox/WebKit not installed).
- **TC-30 driving details.** The soak creates notes with a synthetic `dblclick` on the empty board and edits
  with focus + Enter (story 2's keyboard path). With real double-clicks, the first click could select a
  note that someone else is dragging, and that note's toolbar (which follows it) could catch the second
  click on "Delete note". That is a real but harmless user-level race, not a sync fault. Text that cannot
  land because a busy note hit `STICKY_TEXT_MAX_CHARS` is not tracked as a delivery.
- **Stale e2e server.** `playwright.config.ts` keeps story 1's `reuseExistingServer` outside CI. A
  leftover `wrangler dev` on port 8787 serves whatever is in `dist/client`. If `npm run build`
  (production, no test hooks) ran last, every e2e test times out. Stop the old server first.

## Story 4 — Return to a board and find everything as it was left

- **Room lifecycle.** `src/worker/room-state.ts` holds the design's full lifecycle (`loading`, `ready`,
  `compacting`, `storage-failed`, `load-failed`, `hibernated`) as `nextRoomState(state, event)`. `BoardRoom`
  drives its state through it. `hibernated` is also used by the test-only `unload()` (the room forgets its
  doc and sockets, as a restart would). A `load-failed` room retries loading on a new connection only once
  `LOAD_RETRY_MIN_INTERVAL_MS` has passed since the last failed attempt; earlier connections are accepted
  and closed with 4500 straight away.
- **Storage failure handling.** An `append` failure inside Yjs's `update` handler is recorded, not thrown
  (a throw inside a Yjs observer would surface as a decode error). After the message has been applied,
  the room closes every socket with 1011 and discards its doc, and sends no reply.
- **Echo filtering under hibernation.** Every socket gets a random id via `serializeAttachment`, and the
  broadcast skips the socket whose id matches the update's origin. This avoids depending on WebSocket
  object identity across hibernation.
- **Damaged bytes never half-apply.** Snapshot and log rows are fully decoded (`Y.decodeUpdate`) before
  `Y.applyUpdate`, so a truncated row fails before any of it is integrated.
- **Limit of partial damage (Yjs property).** A quarantined row also blocks later updates *from the same
  Yjs client*, because their clocks depend on it. They stay pending in the doc, and compaction keeps them.
  On a real board this is usually one person's edits from one session. The TC-09 fixture therefore
  models a real shared board: each note is written by its own participant. The test asserts that every
  other note is intact.
- **`BoardStore` extras.** The constructor takes an optional `{ chunkBytes }`. TC-08 uses it to also prove
  a many-chunk snapshot; production always uses `SNAPSHOT_CHUNK_BYTES`. `compact(doc)` (unconditional) is
  public, `compactIfNeeded` calls it, and the test hook uses it. A 2,000-note fixture board encodes to
  ~744 KB, which is 2 chunks at 512 KB. Cloudflare's documented per-row limit for SQLite-backed Durable
  Objects is 2 MB. I could not re-check the current docs (no network), so the 512 KB chunk stays far
  below it.
- **Test seams on `BoardRoom`.** `store` (replaceable), `state`, `loadFailedAt`, `unload()` and
  `loadedDoc()` are public so that integration tests can inject failures and shift the retry clock via
  `runInDurableObject`. `evictDurableObject` (vitest-pool-workers) provides real restarts and hibernation
  in TC-13/15/16/18.
- **Test hooks (TC-24).** `src/worker/test-hooks.ts` serves `POST /__test/boards/:id/{compact,corrupt-snapshot,repair}`
  only when `env.TEST_HOOKS === '1'`. Playwright's `wrangler dev` passes `--var TEST_HOOKS:1`, and
  `wrangler.jsonc` never sets it. The check happens at runtime, so the code ships in the bundle but is
  unreachable in production. `/__test/*` is in `run_worker_first` so that the Worker, not the SPA fallback,
  sees these paths. Without the variable, the Worker passes them to the assets. The integration test in
  `worker.test.ts` checks that production never reaches a room. `corrupt-snapshot` also unloads the room,
  so the next connection loads the damaged state.
- **Client close-code mapping.** `trackConnectionState` also listens to `connection-close`. 4500 →
  `load_failed`, which stays until a sync succeeds, even through network errors while retrying, so the
  board is never shown as empty and editable. 1011/1003 are ordinary disconnects (`reconnecting`).
  y-websocket keeps retrying after 4500 (it only stops for 4400–4499) with its backoff capped at
  `RECONNECT_MAX_BACKOFF_MS`.
- **Edit lock.** `canEdit(state)` (exported from `App.tsx`) is false only for `load_failed`. While it is
  false: the Sticky note button is disabled, double-click creation and the Enter/Delete keys do nothing,
  the note toolbar is hidden, and notes cannot be dragged or edited (`StickyNote` got an optional
  `editable` prop). An open editor is closed. Selection itself is not a board change and still works.
- **Client meta write.** Each browser still runs story 2's `initDoc`, which writes `meta.schemaVersion`
  locally. So every first visit stores one tiny update row; compaction absorbs these. A never-edited
  board creates no rows just by the room opening (TC-25 is checked at the store level).
- **E2E process tests.** `tests/e2e/persistence.spec.ts` (TC-19–21) runs in its own Chromium-only
  Playwright project, `persistence`. Each test starts `wrangler dev --persist-to <tmp> --var TEST_HOOKS:1`
  on port 8790+ and kills the whole process group with SIGKILL for restarts. The spec still relies on
  the shared webServer's `npm run build:test` for `dist/client`. TC-21 seeds the 2,000-note board through
  the real WebSocket protocol from Node (`helpers/seed.ts`), compacts it, restarts, and logs the load
  time against `BOARD_LOAD_BUDGET_MS` (~0.9 s locally), which is reported, not asserted. E2E ran in
  Chromium only.
- **Red phase.** As in earlier stories, test-first phases were not committed separately (single story commit).

## Story 5 — Share a board with others using a link

- **Router lives in `src/client/Root.tsx`.** The design says `App.tsx` "renders router", but `App` is the
  stories 1–4 board component (component tests render it directly with `doc`/`boardId`) and `BoardPage`
  mounts it once the board is `ready`. Putting the router into `App.tsx` would make `App` import
  `BoardPage`, which imports `App`. So `main.tsx` renders `Root` (router) and `App` keeps the board.
  Story 3's `boardIdFromLocation` redirect is gone: `/` is the Home page.
- **`nextBoardPageState` has a 4th parameter `boardId`.** The contract's `ready` state carries
  `boardId`, but the listed signature `(state, result, attempt)` has no way to know it. The extra
  parameter defaults to the id in a `ready` state.
- **Retry delay.** Check attempt *n* (1-based) that fails waits `BOARD_CHECK_RETRY_BASE_MS × 2^(n−1)`,
  capped at `RECONNECT_MAX_BACKOFF_MS`. The retry message stays visible during a retry. The page does not
  flash back to "Opening board…".
- **Existence and storage.** `BoardStore.load()` treats missing tables as an empty board. `migrate()` runs
  only from `initialize()` and lazily before the first `append()`. The room constructor no longer
  migrates. `BoardStore.initialize()` holds the "set `created_at` once" logic and `BoardRoom.initialize()`
  calls it. A board whose tables exist but hold no rows and no `created_at` does **not** exist. That
  state could only come from a story 3/4 room that was opened and never edited. It has nothing worth
  keeping, so Board not found is correct.
- **A storage error during the connection-time existence check counts as "exists".** Otherwise a board
  whose storage is failing would be reported as not found. The existing load path then closes the socket
  with 4500 (story 4 TC-26 still covers this). If the HTTP `GET /api/boards/:id` RPC fails, the result is
  a 500 `check_failed`, and the client treats that as "unreachable" and retries.
- **HTTP details.** `/api/boards` answers 405 with `Allow: POST` for other methods. `/api/boards/:id`
  answers 405 for methods other than GET/HEAD. API responses are `Cache-Control: no-store`.
  `/api/rooms/<malformed>` is now 404 (it was 400), and story 3's TC-04 was updated to match, as the
  design specifies.
- **Test changes for explicit creation.** Rooms are no longer created by connecting, so the story 3/4
  integration tests create their boards with `createBoardId()` (`POST /api/boards`, in `ws-client.ts`).
  The e2e helpers change the same way. `openBoard(page)` with no path goes to the Home page and clicks
  **New board**. `openParticipants` creates the board through the API. The persistence and broken-board
  specs use `createBoard(baseURL)` from `helpers/seed.ts`.
- **TC-12 injection.** The failing RPC is injected by calling the real Worker `fetch` (and `createBoard`)
  with an `Env` whose room stub throws, or returns `exists`, since vitest-pool-workers cannot make a real
  RPC fail on demand.
- **TC-31 legacy seed.** A new test-only hook, `POST /__test/boards/:id/seed-legacy` (enabled only by
  `TEST_HOOKS=1`, like story 4's hooks), stores the request body (a Yjs update) as an `updates` row
  without `created_at` and unloads the room.
- **Share panel.** The Copy link button's accessible name is "Link copied" while confirming; the tick
  (✓) is `aria-hidden`. Focus goes back to the Share button after Escape and after an outside press. The
  link field is labelled "Board link". The Board not found page's link home reads "Go to the home page".
- **TC-26 is Chromium-only** (it needs clipboard-read permission). E2E ran in Chromium only, because
  Firefox and WebKit are not installed. Click-to-board time was about 110 ms against `CREATE_BUDGET_MS`
  (logged).
- **Nightly soak (TC-30) failed once.** One note was deleted without the soak recording the deletion (a
  missing id, seed 4029729626). It passed on re-run. This matches the user-level race described in the
  story 3 notes. The Share button (top right, y < 48 px) is outside the soak's note area (y ≥ 80 px).
- **Red phase.** As in earlier stories, the test-first phases were not committed separately (single
  story commit).

## Story 7 — Select, move, resize and delete several objects at once

- **`snapshot(doc)` stays stickies-only; `objectsSnapshot(doc)` is new.** Story 2's `snapshot` contract (and its
  TC-12, "unknown types are skipped") and many tests type its result as `StickySnapshot[]`. The board now reads
  `objectsSnapshot(doc)`: every object of a *known* type as `ObjectSnapshot` (`id, type, x, y, width, height, z,
  createdAt`, plus `color`/`text` for stickies). `snapshot` = its sticky subset. `stickiesOf(objects)` and
  `isSticky` help narrow. `useBoardDoc` returns `objects` instead of `notes`.
- **Known types live in board-model.** `allObjectIds`/`objectsInRect` (shared code) must skip unregistered
  types, but the registry is client code (it holds React components). `registerObjectType` therefore also calls
  `markObjectTypeKnown(type)` in board-model; `sticky` is known by default. Unknown types are never shown,
  selected or changed.
- **`clampScale` has an optional 5th parameter `uniform`** (default `scale.x === scale.y`). Without it, a
  non-aspect-locked resize that collapses both axes to 0 would look uniform and be clamped as one scale.
- **`resizeRect` with aspect lock:** a corner uses the axis that changed more; an edge handle scales the other axis
  around the box's centre. Unlocked resizes compute edges directly (no float drift). `scaleFromHandle(box, handle,
  scale)` (extra export) rebuilds the box from the clamped scale, anchored at the opposite side/corner.
- **Non-resizable types** (none yet) in a group resize keep their size and follow their scaled centre.
- **Sticky note size.** The note's content is laid out at `STICKY_SIZE_WORLD` and CSS-scaled to the note's width,
  so text fitting (`fitFontSize`) is unchanged and a bigger note shows proportionally bigger text (emphasis).
  The overflow fade height scales via `--sticky-scale`.
- **Selection chrome is generic.** `SelectionOverlay` (screen space, above the board) draws a thin outline per
  selected object, the bounding box and the 8 handles for every type, so the sticky's own CSS outline was removed
  (`data-selected`/`is-selected` stay). Handles are `role="button"` divs labelled "Resize top-left", "Resize
  top", … "Resize left"; they are hidden while editing text or when the board cannot be edited. The box and
  handles also show for a single selected object.
- **SelectionBar extras.** Besides the contract props it takes `camera` (placement above the box, like story 2's
  toolbar), `onColor(id, colour)` (for the single-sticky NoteToolbar) and `hidden` (while dragging/resizing,
  editing, or when the board cannot be edited). The bar reuses the note-toolbar look; its role is
  `toolbar` "Selection". The `aria-live="polite"` announcer is a separate visually hidden element that is
  always rendered (so changes are announced).
- **Clicks.** Press on an unselected object selects only it at pointerdown (then it can be dragged). A click
  (no drag) on a member of a multi-selection selects just that object on release; dragging it moves the group.
  Shift+press on an object toggles it immediately and never starts a drag. Shift+press on empty space with no
  movement selects nothing and keeps the selection.
- **`useSelection` ignores ids not in the snapshot** for `click/toggle/setMany`, but not for `startEdit`: a note
  created a moment ago (double-click / Sticky note button) is not in the snapshot yet. `endEdit(next?)` keeps
  story 2's `'selected' | 'unselected'` argument (default `'selected'`). Pruned ids are hidden in the same
  render (derived) and removed from state by the prune effect.
- **`useTransformGesture` also returns `active`** (`'move' | 'resize' | null`) so notes show their dragging
  state and the bar hides mid-gesture. Pointer move/up/cancel listeners are attached natively to the pressed
  element (with pointer capture), replacing story 2's per-note drag code. With `canEdit` false a press still
  selects on release, but nothing moves or resizes.
- **Keys.** Arrow keys with a selection are always `preventDefault`ed (no scroll or pan), even on a read-only
  board where they do nothing. Escape during a Shift+drag cancels only the rectangle (capture-phase listener),
  not the selection. Enter edits the single selected object when its type has `editableText`.
- **Test hooks (test builds only).** `window.__vidi6.getSelection()` and `seedNotes([...])` (adds notes with
  text/colour/size in one go, used by the story 7 e2e fixture `tests/fixtures/selection-board.ts`).
- **Test-only type.** `tests/fixtures/testbox.tsx` registers `testbox` (resizable, not aspect-locked, minimum 10)
  and is imported only by tests.
- **E2E.** `tests/e2e/selection.spec.ts` (TC-32–TC-36 plus select-all). Chromium only: Firefox and WebKit are not
  installed here, so TC-32 was not run in them.
- **Red phase.** As in earlier stories, test-first phases were not committed separately (single story commit).
- **Presence (story 6) is not built**: the selection is not published to others.

## Story 8 — Undo and redo my own changes without undoing anyone else's

- **Capture timeout is timed by the controller, not Y.UndoManager.** Yjs reads the clock through lib0's
  `getUnixTime = Date.now`, bound at import, so fake clocks (`vi.setSystemTime`, TC-12/TC-13) cannot reach it.
  `createUndo` registers its own `afterTransaction` handler (before the manager's) that calls `stopCapturing()`
  when a local change comes ≥ `UNDO_CAPTURE_TIMEOUT_MS` after the previous one; the manager itself runs with an
  infinite capture timeout. Behaviour is the same as the manager's (pause of exactly the timeout = new step).
- **One press = one step, even when the step has no effect.** Y.UndoManager keeps popping until something changes,
  so undoing a move of a note someone else deleted would also undo the step before it. `undo()`/`redo()` pop
  exactly one stack item (by presenting the manager a one-item stack); a no-effect step is consumed silently
  (PRD alternate flow "the next undo continues normally").
- **Extra controller methods** beyond the design contract: `checkpoint()` / `canUndoSince(checkpoint)` (the text
  editor's Ctrl/Cmd+Z only undoes steps made since the edit began, so it never undoes an earlier move — TC-16)
  and `holdCapture(on)` (gestures hold the capture window open between their boundaries, so a drag that pauses
  ≥ 500 ms mid-way is still one step). `addScope` takes `Y.AbstractType<any>` (with `<unknown>`, `Y.Map<T>` is
  not assignable).
- **Redo inside the editor** (Ctrl/Cmd+Shift+Z, Ctrl+Y) only redoes typing undone in that same edit; typing
  again forgets it. Outside the editor, board shortcuts are the normal undo/redo.
- **Wiring.** `useTransformGesture` is unchanged: its story 7 `onGestureStart/End` hooks are passed from `App.tsx`
  (boundary + hold). Delete/nudge keys (`useBoardKeys`), the Sticky note button / double-click create, and the
  selection bar's colour and delete run between two `boundary()` calls. The editor gets the controller from
  `UndoContext` (in `useUndo.ts`) because registered object components have a fixed props contract.
- **Controller lifetime.** `App.tsx` creates the controller in an effect (StrictMode-safe) and destroys it on
  board change/unmount; until then `NO_UNDO` (empty history) is used. `App` accepts an optional `undo` prop
  (component tests supply a fake).
- **Buttons.** Below the tools, after a divider, in the left toolbar: `aria-label` "Undo"/"Redo", tooltips
  "Undo (Ctrl/Cmd+Z)" / "Redo (Ctrl/Cmd+Shift+Z)", `disabled` plus `aria-disabled`.
- **Ctrl+Y** is redo only with Ctrl (not Cmd), as the PRD says; Cmd+Y is left to the browser.
- **LOAD origin in unit tests.** `tests/unit/peer.ts` uses its own load-origin symbol: story 4's `LOAD_ORIGIN`
  lives in worker code that needs the Workers types, and any non-local origin is equally untracked.
- **Story 7 e2e TC-36** now uses a camera 100 units further left: its rectangles started at screen x=40, which
  is on the (now taller) left toolbar. Assertions are unchanged.
- **E2E** (`tests/e2e/undo.spec.ts`, fixture `tests/fixtures/undo-board.ts`): the board is seeded by the other
  participant (Raj), so the seed is not in Mia's history. Chromium only (Firefox/WebKit not installed).
- **Red phase** not committed separately (single story commit), as in earlier stories.
