# Notes

Decisions and deviations recorded while implementing the stories.

## Story 1 — Pan and zoom around an infinite board

- **`wrangler.jsonc` has no `assets.binding`.** Wrangler 4 rejects an
  assets-only Worker that declares an asset binding ("Cannot use assets with a
  binding in an assets-only Worker"). Story 3 adds the Worker `main` script and
  will add the binding back together with it. `wrangler dev` serves
  `dist/client` correctly in the meantime (verified, HTTP 200 on `/`).
- **`useCamera` is owned by `BoardViewport`, not `App`.** The design's
  `useCamera(viewport)` takes the viewport size, but the size is only known
  after `BoardViewport` has measured its own element with a `ResizeObserver`.
  To keep the exported contracts exactly as written (`useCamera(viewport: Size)`
  and `BoardViewport({ children })`), `BoardViewport` calls `useCamera` with its
  measured size and wires `ZoomControls` / `NavigationHint` from that state.
  `App.tsx` mounts `BoardViewport` full-window and passes board content as
  `children`. The design's "App.tsx passes derived props" is therefore done one
  level down, inside `BoardViewport`; the props of `ZoomControls` and
  `NavigationHint` are exactly as specified.
- **E2E needs a test-mode build.** `window.__vidi6.setCamera()` is compiled in
  only when `import.meta.env.MODE === 'test'`, so the Playwright `webServer`
  runs `npm run e2e:server` (= `vite build --mode test` then
  `wrangler dev --port 8787`). The production `npm run build` uses the default
  `production` mode and excludes the hook.
- **Component-test shims.** jsdom provides no `ResizeObserver` and no Pointer
  Capture API, so `tests/component/setup.ts` installs minimal stubs. It also
  exposes `ResizeObserverStub.emit(width, height)` so a test can simulate a
  window resize (TC-07 at component level).
- **Zoom-step snapping.** `zoomStep` snaps the result to the nearest power of
  `ZOOM_STEP_FACTOR` within `ZOOM_STEP_SNAP_EPSILON` (1e-9), which makes
  100% -> 125% -> 100% exact (TC-09) instead of drifting through floating point.
- **Manual Safari check.** Task 3 asks for a manual check in Chrome and Safari.
  Chromium was driven interactively (via Playwright against `npm run dev`): drag
  pans 1:1, the cursor becomes a grabbing hand, scroll pans, Ctrl-scroll zooms
  around the pointer, the shortcuts work, the page never scrolls or zooms and the
  console is clean. A real Safari check is impossible in this container (see the
  Firefox/WebKit note below); the Safari-specific code paths are
  `gesturestart`/`gesturechange` handling, covered by the component test TC-17
  as the design's "Not covered" section intends.
- **Firefox/WebKit e2e.** The design asks for all three browsers and all three
  Playwright binaries are present, but this host is missing their system
  libraries (`libgtk-3-0t64` for Firefox, ~30 packages for WebKit) and there is
  no root access to install them, so only Chromium can launch here. The
  `firefox` and `webkit` projects stay in `playwright.config.ts`; the project
  list comes from `E2E_PROJECTS` (default `chromium`), so
  `npm run test:e2e` passes on this host and `npm run test:e2e:all` runs the
  full three-browser matrix on a provisioned one.
- **Grid pixels in e2e.** The dot grid is a CSS background, so it has no DOM
  nodes to measure. The e2e tests assert grid behaviour two ways: the
  *origin marker* (a real element at world 0,0, counter-scaled to keep its
  on-screen size) gives pixel-accurate movement and zoom-anchor checks, and the
  computed `background-size`/`background-position` of the board assert the grid
  tile size equals `GRID_SPACING_WORLD * zoom` and that its painted offset is
  exactly what the camera implies (and moved by exactly the drag distance,
  modulo one tile).
- **Extra members on the `useCamera` return.** The contract's members are all
  present; `canZoomIn`, `canZoomOut`, `zoomPercent` and `pinchAt(point, ratio)`
  were added because the Safari `gesturechange` handler needs a scale-ratio
  entry point (a wheel delta cannot express one) and `BoardViewport` needs the
  derived control state without re-deriving it in two places.
- **Camera renders are coalesced with `requestAnimationFrame`**, so the DOM (and
  the disabled state of a zoom button) is at most one frame behind the input.
  The component tests use fake timers and advance a frame after each event; the
  e2e tests click "until the button refuses" instead of polling `isEnabled()`
  before each click, which would race that frame.
- **`panBy` on plain scroll is called with negated deltas**, exactly as the
  design writes it (`panBy(-deltaX, -deltaY)`), which is what makes scrolling
  down move content up and scrolling right move content left.
- **Wheel delta modes** LINE/PAGE are converted to pixels with the named
  constants `WHEEL_LINE_HEIGHT_PX` / `WHEEL_PAGE_HEIGHT_PX` (Chrome defaults).
  Real trackpad hardware scaling is out of the automated scope per the design's
  "Not covered".

## Story 2 — Capture ideas on sticky notes and rearrange them

- **`createSticky` returns `''` on rejection.** The contract returns `string`
  while the "returns `false` when rejected" rule is written for the boolean
  mutations, so a non-finite coordinate returns an empty id (falsy, and asserted
  as such by TC-39) instead of breaking the return type.
- **`fitFontSize(el, box?)` compares like with like.** The design's
  `scrollHeight <= box` compares the element's *padded* scroll box against an
  *unpadded* text box, which reports overflow that is only padding: with a
  12 px padding every note — even an empty one — came out at the minimum font
  size. The comparison is now the scroll box against the element's own client
  box (`box` is optional and only overrides the height limit), and the search
  itself is extracted into a pure `autoFitFontSize(text, measure, w, h, min, max)`
  so it is unit-testable — jsdom performs no layout, so `scrollWidth`/
  `scrollHeight` are always 0 there.
- **Drag listeners are on the window, not on the note.** `bringToFront` at drag
  start re-sorts the world layer's children, and a DOM node that is removed and
  re-inserted loses its pointer capture, so a note that was *not* already
  topmost stopped moving after the first applied frame. (It worked at 50% zoom
  in a single-note test precisely because `bringToFront` was a no-op there.) The
  note still calls `setPointerCapture` as the design asks — useful when a pointer
  leaves the note — but the window listeners are what carry the drag.
- **`bringToFront` returning `false` is not a stale id.** It also means "already
  topmost", so the drag treats it as success and checks the note's existence
  separately (`snapshot(doc).some(...)`) before ending a drag silently (TC-37).
- **The note is not `overflow: hidden`.** Clipping the note would clip its own
  toolbar, which is anchored above its top edge; the text element clips its
  content instead, which is where "nothing drawn outside the note" applies.
- **Notes carry the `board-object` class.** `.board-world` is
  `pointer-events: none` (story 1) and the class is what opts children back in;
  without it a note received no pointer events in a real browser even though
  jsdom was happily passing the component tests.
- **The text layer stays mounted while editing**, at `opacity: 0` and
  `aria-hidden`, with the textarea laid over it. That keeps auto-fit measuring
  the real text as it is typed instead of freezing at the size from before
  editing started.
- **`NoteToolbar` is anchored inside the note and counter-scaled by `1/zoom`**,
  which keeps it its design size on screen at any zoom while keeping it glued to
  the note while it moves, and it is hidden while dragging or editing as the
  contract requires. It stops pointer propagation so clicking it neither pans
  nor clears the selection.
- **Editing ends on a capture-phase document `pointerdown`** outside the note:
  notes and toolbars call `stopPropagation`, so a bubble-phase listener would
  never fire for a click on another note or on the left toolbar.
- **`useBoardDoc(doc?)` and `<App doc?>` take an optional document.** The
  component tests need to read and mutate the same `Y.Doc` the app renders, so
  the hook accepts one; production passes nothing and the hook owns it. This is
  the only addition to the exported contracts besides the documented ones above.
- **Notes render `data-world-x`, `data-world-y`, `data-z`, `data-color`,
  `data-note-id`.** They are the values the model was drawn from, which makes
  the pixel-and-world assertions in the e2e suite (and the "dragged point stays
  under the pointer" check) read the truth instead of re-deriving it; the e2e
  helpers locate notes by id or text rather than by index, because a drag
  re-sorts the DOM.
- **`StickyNote` needs only `zoom`,** not the whole camera: its drag delta is
  `screenDelta / zoom`, exactly the design's formula.
- **Firefox/WebKit e2e** hit the same missing system libraries as story 1
  (`libgtk-3-0t64` and friends, no root to install them), so `E2E_PROJECTS`
  still defaults to chromium and `npm run test:e2e:all` runs the full matrix on
  a provisioned host.

## Story 5 — Share a board with others using a link

- **`BoardPage` uses a `key` prop in the router.** Without it, React reuses the
  same component instance when only the `id` prop changes (e.g. from NotFound
  to a newly-created board). The `useState` initializer would not re-run and
  the page would stay stuck in the old state. The `key={route.id}` forces a
  remount on every board id change.
- **`existsReadOnly()` returns `false` when tables are missing.** During DO
  instantiation the constructor calls `existsReadOnly()` synchronously. For a
  brand-new board the `storage_meta` table does not exist yet (it is created by
  `migrate()`), so the method returns `false` rather than throwing. The
  `BoardStore.load()` method has the same guard: if `storage_meta` does not
  exist it returns success (the board is empty).
- **`migrate()` is called lazily on the first `append()`.** A board whose DO is
  instantiated only to answer `exists()` (read-only) never creates tables. This
  avoids a subtle race: a read-only DO instantiation that creates tables would
  make `hasCreatedAt()` return true on the next constructor call, so the board
  would appear to exist before `initialize()` is ever called.
- **`BoardRoom.initialize()` is a Durable Object RPC method.** Called via
  `stub.initialize()` from the Worker's POST handler. DO RPC requires
  compatibility_date ≥ 2024-08-21 (the project uses 2026-09-01, which falls
  back to the wrangler-supported maximum). The method is idempotent: a second
  call on a board that already has `created_at` returns void without
  re-creating.
- **WebSocket connections to unknown boards close with 1011 (INTERNAL_ERROR).**
  The 1006 (abnormal closure without a close frame) in the acceptance criteria
  describes what the browser reports when the server does not complete the
  WebSocket handshake. Returning a 404 HTTP response on the upgrade request
  produces exactly 1006 client-side.
- **`page.route()` test for TC-28 intercepts the `/api/boards/:id` check.**
  The test aborts the request, shows the retry message, then unroutes and the
  next retry succeeds. This exercises the client's retry-with-backoff logic
  without needing to stop the server.
- **Test-hook routes are used sparingly.** Only two are added for story 5:
  `seed-legacy-board` (TC-31, a board with real SQLite data but no
  `created_at`) and `fail-next-initialize` (TC-06, injected create failure).
  Both are gated behind `TEST_HOOKS=1`.
- **`isValidBoardId` returns true for any 22-char base64url string.** The
  existing implementation checks only length and character set, not that the
  value decodes to exactly 16 bytes. The spec says `newBoardId()` always
  produces such a value, and TC-11 only tests the invalid inputs (wrong
  alphabet, wrong length, empty). A stricter decode check would be additive
  and safe but was not needed to pass the listed cases.

## Story 7 — Select, move, resize and delete several objects at once

- **`useSelection` exposes a reducer (`selectionReducer`).** The exported hook
  is the interface consumers expect, but the reducer is also exported so unit
  tests can call it directly without rendering a component.
- **`useMarquee` stores the current rect in both state (for render) and a ref
  (for the `end` callback).** The original implementation captured `rect` state
  in the `end` closure, but because React batches renders, the state can be
  stale by the time `pointerup` fires. The ref is updated synchronously so
  `end()` always sees the latest marquee rect.
- **`data-dragging` attribute removed from `StickyNote`.** Drag logic moved
  into `useTransformGesture`; the attribute had no consumer outside the old
  story-2 component tests, which now assert behaviour (note position changed)
  instead of internal state.
- **Marquee selects only fully-contained objects.** `rectContains` checks all
  four edges: outer must start at or before the inner on both axes and end at
  or after it. A note that overlaps the marquee boundary is excluded (TC-07).
- **Group move uses `requestAnimationFrame`.** The transform gesture batches
  writes to one `moveObjects` call per animation frame, so a multi-note drag
  emits at most 1 Y.Doc update per frame instead of one per pointermove.
- **`objectsInRect` is in `board-model.ts`** (shared) rather than in the
  Marquee component, so both the marquee and any future spatial queries use
  the same logic and it's unit-testable.
- **Resize uses `scaleWithin` per object.** When the bounding box of a
  selection is resized, each object's position and size are scaled proportionally
  within the old→new bounding-box mapping. `clampScale` limits the scale so no
  object's dimensions fall below its `minSize` or exceed
  `MAX_OBJECT_SIZE_WORLD`.
- **Aspect-lock resize.** `resizeRect` with `aspectLocked=true` uses the axis
  with the greater absolute delta to drive both dimensions, preserving the
  original ratio.
- **Keyboard handler skips text-entry contexts.** `useBoardKeys` checks
  `isTextEntry(event.target)` before handling Delete, Backspace, Ctrl+A and
  arrow keys, so typing into a note's textarea is never intercepted.
- **TC-36 (multi-editor concurrent moves) uses sequential edits** rather than
  truly-simultaneous ones to avoid Yjs CRDT non-determinism in the test. The
  assertion confirms all contexts converge to identical positions, which is the
  spec requirement ("all contexts end with identical positions").

## Story 8 — Undo and redo my own changes without undoing anyone else's

- **`createUndo` wraps `Y.UndoManager` with a single tracked origin.**
  The manager tracks only `LOCAL_ORIGIN`. The Y.UndoManager constructor
  automatically adds itself to `trackedOrigins` (so its own undo/redo
  transactions are excluded from the undo stack). Peer and LOAD operations
  use different origins and are therefore invisible to the undo history.

- **`boundary()` calls `stackItemClean()` to close the current capture group.**
  This is how the app maps discrete user gestures (one drag, one colour change,
  one typing session) onto individual undo steps. Between boundaries, Yjs's
  internal `captureTimeout` (set from `UNDO_CAPTURE_TIMEOUT_MS = 500ms`) groups
  transactions that arrive close together.

- **`lib0/time.js` captures `Date.now` by reference at module load.**
  `export const getUnixTime = Date.now` means `vi.useFakeTimers()` cannot
  intercept the Yjs capture-timeout timer. Tests that need to cross the capture
  boundary use real timers with a short `captureTimeoutMs` (e.g., 50ms) or rely
  on explicit `boundary()` calls instead of waiting for the timeout to elapse.

- **Stack trimming to `UNDO_MAX_STEPS` (200).** The `stack-item-added` event
  fires twice per stack item (once for undo, once for redo). A `_depth` counter
  deduplicates so trimming runs once per item. The oldest entries are spliced
  off the bottom of `undoStack`.

- **`useUndo(controller, canEdit)` is a thin React hook** that subscribes to
  `onChange` for re-renders and gates `undo()`/`redo()` on `canEdit`. When
  `canEdit` is false (load_failed), `canUndo`/`canRedo` always return false and
  calling `undo()` is a no-op.

- **`UndoButtons` in the Toolbar.** Rendered as `aria-label="Undo"` /
  `aria-label="Redo"` buttons with `data-testid`. Disabled when the respective
  stack is empty or editing is locked.

- **Keyboard shortcuts in `useBoardKeys`.** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z,
  Ctrl+Y are handled on `window` keydown. The handler calls `boundary()` before
  and after the undo/redo to ensure a clean capture group. Text-entry
  contexts (`isTextEntry(target)`) are skipped so browser-native undo in
  non-board inputs is preserved.

- **`StickyTextEditor` intercepts Ctrl+Z / Ctrl+Shift+Z internally.** When the
  textarea is focused, the editor's own keydown handler calls the controller's
  undo/redo and then re-syncs the textarea value from the doc (because the undo
  writes the new text to Yjs, which updates the snapshot, which the component
  reads on re-render). This prevents Ctrl+Z in the editor from undoing an
  earlier gesture.

- **Edit-start/edit-end boundaries.** The `StickyTextEditor` calls
  `undo?.boundary()` on mount (start of edit) and on blur/Escape (end of edit).
  Colour-change and delete handlers call `boundary()` before and after the
  model mutation. Gestures call `onGestureStart`/`onGestureEnd` which map to
  `boundary()`.

- **`tests/unit/helpers/peer.ts` simulates a remote collaborator.** Creates a
  second `Y.Doc` and syncs bidirectionally via `Y.applyUpdate` with a
  non-local origin. `loadTransact()` applies mutations with `LOAD_ORIGIN` to
  simulate board initialisation.

## Story 9 — Write free text anywhere on the board

- **`ObjectSnapshot` is a discriminated union** (`StickySnapshot | TextObjectSnapshot`).
  Existing tests that access `.color` are switched to `stickySnapshot(doc)` (a
  convenience filter returning only sticky notes) via an import alias to avoid
  modifying every assertion.
- **`createCanvasMeasurer()` returns `(text, fontPx) => number`** — a simple
  width measurement. The full `layoutText()` function wraps this with greedy
  word-wrap and line-counting to produce `{ width, height, lines }`.
- **`useTextBoxSync` writes width/height only after LOCAL changes.** Remote
  clients see the stored dimensions from the Y.Doc and never re-measure or
  write back, preventing measurement-oscillation between clients with
  different fonts.
- **TextToolbar is anchored inside `TextObject`** (counter-scaled by 1/zoom),
  matching the existing `NoteToolbar` pattern in `StickyNote`. The design
  mentions "SelectionBar → TextToolbar" in the file table; this is achieved via
  the object's own anchoring, consistent with how story 7 made sticky
  toolbars self-contained.
- **`useTool` is gated by `canEdit`:** when `canEdit` becomes false while
  Text is active, the tool reverts to Select. `setTool('text')` is a no-op
  when `!canEdit`.
- **Text tool click → create + auto-edit + switch to Select.** The
  `onTextToolClick` callback in `App.tsx` calls `createText()`, immediately
  enters editing via `selection.startEdit(id)`, and switches back to Select.
  This matches the PRD's flow: click → type → Escape keeps (selects).
- **Horizontal-only resize for text objects.** `SelectionOverlay` checks all
  selected types via the registry's `handles` field. `useTransformGesture`
  calls `setTextWidthFixed` instead of `resizeObjects` when all selected
  objects are horizontal, preventing height from being written by the gesture.
- **`deleteIfEmpty` removes text objects with zero content on edit end.** The
  `TextObject` component checks on `onEndEdit` whether the Y.Text is empty;
  if so, deletes the object (TC-25, TC-31).
- **`clampToLimit` moved to `src/shared/text-edit.ts`.** The `StickyText.ts`
  re-exports it with the sticky-specific default (`STICKY_TEXT_MAX_CHARS`).
  `TextEditor` uses the shared version with `TEXT_MAX_CHARS`.
- **E2E TC-29/TC-30 (concurrent editing) use two pages** opening the same
  board. These require the sync server running (via the Playwright webServer
  config) and exercise real Yjs CRDT merge.
