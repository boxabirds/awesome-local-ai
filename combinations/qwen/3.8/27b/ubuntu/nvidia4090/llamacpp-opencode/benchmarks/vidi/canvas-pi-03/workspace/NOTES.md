# Story 1: Pan and zoom around an infinite board — Implementation Notes

## What was built

A working React + Vite + TypeScript SPA with a camera-based infinite board viewport. The board
renders a subtle dot grid and a world-origin crosshair, with full pan and zoom controls.

### Key files

| File | Purpose |
|------|---------|
| `src/shared/config.ts` | Shared constants (zoom min/max, step, grid spacing, hint key) |
| `src/client/canvas/camera.ts` | Pure camera maths: `screenToWorld`, `worldToScreen`, `panBy`, `zoomAt`, `zoomStep`, `resetCamera` |
| `src/client/canvas/useCamera.ts` | React hook managing camera state with viewport resize handling |
| `src/client/canvas/CameraContext.tsx` | React context for sharing camera state across components |
| `src/client/canvas/BoardViewport.tsx` | The board: dot-grid background, world layer, pointer/wheel/gesture/keyboard input |
| `src/client/canvas/ZoomControls.tsx` | Bottom-right zoom in/out/percent/reset control |
| `src/client/canvas/NavigationHint.tsx` | Dismissible onboarding hint |
| `src/client/canvas/testHooks.ts` | Test-only `window.__vidi6` hook (enabled in `--mode test` builds) |
| `src/client/App.tsx` | App shell composing the viewport, controls, and hint |

### Camera model

- State: `{ x, y, zoom }` — world coordinates at the viewport centre plus a zoom factor.
- `screenToWorld(p, cam, vp)` converts screen pixels to world coordinates.
- `worldToScreen(p, cam, vp)` converts world coordinates to screen pixels.
- `zoomAt(cam, point, factor)` zooms while keeping the world point under `point` fixed.
- `panBy(cam, dx, dy)` shifts the camera by screen-pixel deltas.
- Zoom range clamped to `[0.25, 4]`; step factor is 1.25 (or 0.8 inverse).
- Grid: CSS `radial-gradient` dot pattern on the viewport, size and position derived from camera state.
  At zoom 1 the dots are 24px apart (world units); at higher zoom the pattern scales up.

### Input handling

- **Pointer drag** (left button): `setPointerCapture` → `pointermove` deltas pan the camera.
  `pointercancel` and `pointerup` end the drag.
- **Wheel** (non-passive): plain scroll pans; `Ctrl+wheel` or `⌘+wheel` zooms at the cursor.
  `preventDefault()` on all handled events.
- **Pinch (Safari)**: `gesturestart`/`gesturechange`/`gestureend` with `preventDefault()`;
  scales around the gesture centroid.
- **Keyboard**: `Ctrl/⌘+=` zooms in, `Ctrl/⌘+-` zooms out, `Ctrl/⌘+0` resets.
  `preventDefault()` on all handled shortcuts.
- All gestures are board-local: `visualViewport.scale` and `devicePixelRatio` are never touched.

### Coordinate accuracy

- Pure CSS `transform: scale(zoom) translate(-cam.x, -cam.y)` on a `position: absolute` world layer.
- The dot-grid background uses `background-size` and `background-position` derived from the same
  camera values, so they stay in sync.
- No rounding is applied to camera state; only display values (zoom label) are rounded.
- This keeps the origin marker moving exactly 1 CSS pixel per screen pixel at zoom 1, even
  at coordinates like (1,000,000, 1,000,000).

### Testing strategy

- **Unit tests** (Vitest, no DOM): all camera maths functions tested for correctness, clamping,
  and round-trip conversions. 15 tests.
- **Component tests** (Vitest + jsdom + Testing Library): pointer drag, pointercancel, wheel pan,
  Ctrl+wheel zoom, gesture events, keyboard shortcuts, hint dismissal, zoom controls. 15 tests.
- **E2E tests** (Playwright, Chromium): real browser tests verifying pixel-exact drag movement,
  zoom-anchor correctness, hint lifecycle, limit clamping, far-travel accuracy, and page-zoom
  isolation. 7 tests.

### Test-only hook

`window.__vidi6.setCamera({x, y, zoom})` and `window.__vidi6.getCamera()` are available only
when the app is built with `--mode test` (`npm run build:e2e`). Used by e2e tests to jump
the camera to far coordinates.

### Local dev

```bash
npm install
npm run dev          # Vite dev server
npm run test         # Unit + component tests
npm run test:e2e     # E2E (builds test mode, starts vite preview)
npm run typecheck    # TypeScript
npm run build        # Production build → dist/client/
```

## Deviations from the spec

1. **Server**: Uses `vite preview` for e2e testing instead of `wrangler dev`. The wrangler config
   and worker stub are in place for story 3; the e2e `webServer` command can be switched back once
   the worker is functional. The playwright config currently uses `vite preview` for reliability.

2. **Workers**: Only Chromium is tested for e2e. Firefox and WebKit projects are defined in
   `playwright.config.ts` but the browsers are not installed in this environment. Run
   `npx playwright install --with-deps firefox webkit` to enable them.

3. **Grid rendering**: Uses CSS `radial-gradient` for the dot grid rather than a canvas element.
   This is simpler, GPU-accelerated, and keeps the world layer as pure DOM (consistent with
   story 2's plan for DOM-based sticky notes). The spec mentions "canvas layer for the grid" but
   the CSS approach is functionally equivalent and avoids mixing canvas + DOM compositing.

4. **Zoom step**: Uses 1.25× per step (not 1.2). This gives 7 steps from 100% to ~381%, then clamps
   at 400%, matching the PRD's "roughly seven steps to 400%".

---

# Story 2: Capture ideas on sticky notes and rearrange them — Implementation Notes

## What was built

Sticky notes on the board: create by double-click or toolbar button, edit text with automatic
font fitting, drag to move (zoom-accurate), recolour (6 colours), delete, and z-ordering
(bring-to-front on drag). All board state lives in a local `Y.Doc` from day one.

### Key files

| File | Purpose |
|------|---------|
| `src/shared/board-model.ts` | Framework-free board model on a `Y.Doc` (create/move/colour/delete/bringToFront/snapshot) |
| `src/client/board/useBoardDoc.ts` | Owns the `Y.Doc`; memoised snapshot via `useSyncExternalStore` |
| `src/client/board/useSelection.ts` | Local selection/editing state (never stored in the doc) |
| `src/client/objects/StickyNote.tsx` | Note element: select, drag, edit entry, font-fit mirror, fade, toolbar |
| `src/client/objects/StickyTextEditor.tsx` | Uncontrolled textarea: diff-based Yjs writes, IME, clamp, Escape, click-outside |
| `src/client/objects/StickyText.ts` | Pure text helpers: `clampToLimit`, `applyTextDiff`, `counterVisible`, `fitFontSize` |
| `src/client/objects/NoteToolbar.tsx` | Per-note colour swatches + delete, unscaled above the note |
| `src/client/board/Toolbar.tsx` | Global top toolbar with the Sticky note button |
| `src/client/App.tsx` | Wiring: keyboard shortcuts, selection, stale-state cleanup, stable note order |
| `tests/fixtures/texts.ts` | Realistic fixtures: short text, retro item, exactly 1,000 chars of prose |

### Board model

- `initDoc` sets `meta.schemaVersion` (persisted/wire format anchor for stories 3-4).
- Each successful mutation runs exactly one `doc.transact(fn, LOCAL_ORIGIN)`; rejections
  (stale id, unknown colour, non-finite coordinates) return `false`/`''` before any transaction,
  so failed calls emit no Yjs update (unit-asserted per call).
- Coordinates are the note's top-left; `createSticky` subtracts `STICKY_SIZE_WORLD / 2` so the
  note centres on the click point.
- `snapshot` returns notes sorted by `(z, id)`; unknown object types are skipped (forward-compat).

### Y.Doc ownership

`useBoardDoc` creates a single `Y.Doc` in `useState`, observes `objects` deeply, and recomputes
the memoised snapshot into a cache ref before notifying `useSyncExternalStore`. Rendering is
re-driven by snapshot reference change only.

### Stacking: z-index, not DOM order

Notes render in **stable creation order** and stack via CSS `z-index: note.z`. Rendering in z
order would make `bringToFront` (called at drag start) reorder the React children, moving the
dragging note's DOM node — and the browser **implicitly releases pointer capture when the
capturing node is moved**, which kills the drag after the first move (found via e2e TC-32).

### Text editing

- Uncontrolled textarea (`defaultValue`); `input` computes a character diff and applies it to
  `Y.Text` (one Yjs update per input event).
- Input beyond 1,000 chars is clamped; the caret moves to the end of the kept text.
- IME: `compositionstart/end` tracked; diffs only after composition end (manual-check scope).
- Escape ends editing keeping selection; click outside (window-level capture pointerdown) ends
  it unselected. Enter while selected starts editing with the caret at the end.
- Font fit: hidden mirror div (same width/font as display text) binary-searched 10-24px in
  0.5px steps on text change; overflow shows a transparent-to-colour fade at the bottom.
  The editor mirrors the same size. Re-fit is not needed on zoom (world units scale uniformly).

### Drag

3px screen-pixel threshold (below = select, not move). Movement is rAF-throttled
`moveObject`; `pointerup`/`pointercancel` flush the pending position synchronously, so the note
always ends exactly under the pointer. `bringToFront` runs once at drag start. If the note is
deleted mid-drag (`moveObject` returns false), the drag ends silently (TC-37).

### Keyboard (board level)

Enter edits the selected note; Delete/Backspace deletes it — only when not editing text
(guard: no active editing state and event target is not INPUT/TEXTAREA/contentEditable).

## Deviations / notes for story 2

1. **E2E viewport is 1280x720, not 1280x800.** The chromium project spreads
   `devices['Desktop Chrome']`, whose own viewport (1280x720) overrides the global `use.viewport`
   in `playwright.config.ts`. Initial camera is therefore `{x:-640, y:-360, zoom:1}`; the e2e
   specs compute coordinates from that. Left the config as-is (story 1 territory).

2. **React 19 test quirks handled in component tests:**
   - `useSyncExternalStore` updates triggered by programmatic `el.click()` are not flushed
     synchronously; use RTL `fireEvent.click` (wraps in `act()`) or wrap in `act()`.
   - No global `JSX.Element` namespace — components return `ReactElement`.
   - Uncontrolled textarea value changes in tests need `fireEvent.input` (native setter)
     to fire React's `onChange`; assigning `.value` + dispatching does not.

3. **Test-only hooks extended:** `window.__vidi6.getNotes()` (snapshot) and `getDoc()` (the
   `Y.Doc`, for direct model calls from tests), enabled in `--mode test` builds only.

4. **Test counts:** 40 unit (15 camera, 15 board model, 10 sticky text), 39 component, 13 e2e
   (6 story 1 + 7 story 2). All green on Chromium.

5. **500-note performance run** remains a manual script (not a CI gate) per the design doc;
   the z-index stacking keeps per-note re-renders local to the mutated note's style.

## Local dev

```bash
npm run test:unit
npm run test:component
npm run test:e2e -- --project chromium
npm run typecheck
npm run build
```

# Story 5: Share a board with others using a link — Implementation Notes

## What was built

Boards are now addressable: `POST /api/boards` creates one (rate-limited), `GET
/api/boards/:id` checks existence, and `/b/:id` renders the board for any visitor.
Unknown or malformed ids land on a not-found page. The board page shows a share
panel (copy link) for the creator.

### Key files

| File | Purpose |
|------|---------|
| `src/worker/create-board.ts` | id generation (crypto, 3 retries), fixed-window rate limit (binding or in-memory fallback), DO `initialize()` RPC |
| `src/worker/index.ts` | `POST /api/boards`, `GET /api/boards/:id`; `/api/rooms/:id` now 404s unknown/malformed ids (was 400) |
| `src/worker/board-store.ts` | lazy tables: created by `initialize()`/first write instead of at DO construction; `existsReadOnly()` for the existence check |
| `src/worker/board-room.ts` | `extends DurableObject`; `initialize()`/`exists()` RPC; `fetch()` 404s unknown boards |
| `src/worker/test-hooks.ts` | `initialize`, `exists`, `seed-legacy` ops (plus `x-test-visitor`, `x-test-create-ids`, `x-test-fail-initialize` headers) |
| `src/client/router.ts` | tiny hashless router: `parseRoute`, `useRoute` (`useSyncExternalStore` + `popstate` + `getSnapshot` re-sync), `navigate` |
| `src/client/api.ts` | `checkBoard`, `createBoardRequest` |
| `src/client/pages/` | `HomePage` (create), `BoardPage` (existence check + exponential-backoff retry), `NotFoundPage`, `useCreateBoard` |
| `src/client/share/SharePanel.tsx` | copy-to-clipboard link panel (Clipboard API + manual fallback, Escape/outside close) |
| `src/client/board/Board.tsx` | board surface extracted from `App.tsx`; exports `canEdit` |
| `index.html` | `<meta name="referrer" content="no-referrer">` so share links leak no referer |

### Design decisions

- **Rate limiting.** `wrangler.jsonc` declares a `BOARD_CREATE_LIMITER` ratelimit
  (10/60s). Local workerd does not support ratelimit bindings, so the worker falls
  back to an in-memory fixed-window limiter keyed by visitor when the binding is
  undefined; production uses the real binding. Visitor key: cookie or
  `x-test-visitor` (test override keeps parallel e2e creations independent).
- **Lazy migration.** `migrate()` no longer runs at DO construction; a fresh board
  has no tables until `initialize()` or the first write. `existsReadOnly()` treats
  "tables exist but empty" as a non-board so 404 stays correct.
- **`extends DurableObject`.** Local workerd requires `extends DurableObject`
  (from `cloudflare:workers`) for RPC; `implements` does not work locally.
- **BoardPage retry.** Existence-check failures retry with exponential backoff
  (base 1s, capped at `RECONNECT_MAX_BACKOFF_MS`) to ride out DO cold starts.
- **Router `getSnapshot` re-sync.** Re-parses `location.pathname` every call so
  external `pushState` (tests, `window.location` edits) is picked up without a
  `popstate` event; the cached route object only changes when the route changes
  (stable snapshots for `useSyncExternalStore`).

### Test notes

- **Component tests:** `renderFullApp` is async (BoardPage performs an existence
  check in a microtask); all full-app renders `await` it and mock `@/client/api`.
- **RoomClient `autoInit`:** the integration `ws-client` calls the `initialize`
  hook before connecting (default on), matching what a real browser does via
  BoardPage's check.
- **TC-31 (legacy data):** legacy rows are seeded with `seed-legacy`, then
  `simulate-reconstruct` forces the room's doc to reload from storage (the room
  instance is reused by the WS and predates the seeded rows).
- **TC-21 race (persistence):** the y-websocket provider flushes client doc
  updates asynchronously; `broadcastMessage` silently drops updates while the
  socket is not open, and closing the page drops frames still in flight. The
  test now waits until `load-fresh` reports all seeded notes are durable before
  compacting and closing the seed page.
- **yjs v13:** no `encodeUpdateAsBase64` export — use
  `Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')`.
- **Playwright:** `test.describe` + `test.describe.configure({ timeout })`
  (no top-level `describe`, no 3rd-arg `test()` timeout in this version).

# Story 7: Select, move, resize and delete several objects at once — Implementation Notes

## What was built

Multiple objects can be selected (click, shift-click, shift-drag marquee, select-all),
moved and resized as a group via bounding-box handles, nudged with the arrows, and deleted
with one key press. One consistent code path for every registered object type.

### Key files

| File | Purpose |
|------|---------|
| `src/shared/geometry.ts` | Pure rect/handle math: `rectContains`, `unionRects`, `normalizeRect`, `resizeRect`, `clampScale`, `scaleWithin` |
| `src/shared/board-model.ts` | Generic object ops: `objectBounds`, `objectSnapshot`, `objectsInRect`, `allObjectIds`, `moveObjects`, `resizeObjects`, `bringObjectsToFront`, `deleteObjects`, `stickyNotes`; known-type registry |
| `src/shared/config.ts` | `HANDLE_SIZE_PX`, `STICKY_MIN_SIZE_WORLD`, `MAX_OBJECT_SIZE_WORLD`, `NUDGE_STEP_WORLD`, `NUDGE_LARGE_STEP_WORLD` |
| `src/client/objects/registry.tsx` | `registerObjectType`/`getObjectType` — Board renders any type through its spec (Component + resize policy) |
| `src/client/board/useSelection.ts` | Pure `selectionReducer` + `useSelection` hook (click/toggle/setMany/clear/prune/edit; auto-prunes ids that leave the doc; `pendingEditRef` for create-and-edit) |
| `src/client/board/useTransformGesture.ts` | Board-level move/resize gesture: window pointer listeners, 3px threshold, rAF-throttled writes, synchronous flush on up/cancel |
| `src/client/board/useMarquee.ts` / `Marquee.tsx` | Shift-drag marquee (additive selection); pure `useMarquee` + `MarqueeRect` |
| `src/client/board/useBoardKeys.ts` | Ctrl+A, Escape, arrows (nudge), Delete/Backspace, Enter — all gated by `canEdit` |
| `src/client/board/SelectionOverlay.tsx` | Bounding box + 8 resize handles in screen space (aria-labelled, positioned cursors) |
| `src/client/board/SelectionBar.tsx` | "N selected" + Delete for multi-select; re-uses `NoteToolbar` for a single sticky |
| `src/client/board/Board.tsx` | Composes doc, selection, marquee, gesture, keys, overlay, bar; renders objects through the registry |
| `src/client/board/useBoardDoc.ts` | Doc lifecycle + objects state (`useLayoutEffect` observer + `useState`) |
| `src/client/canvas/BoardViewport.tsx` | Shift+pointerdown on empty space starts the marquee (instead of panning); crosshair cursor |
| `tests/fixtures/testbox.tsx` | Self-registering second object type for tests (resizable, free aspect) |

### Design notes

- **Selection is Board-level, not per-object.** `StickyNote` no longer drags itself; it forwards
  `pointerdown` to the gesture hook and receives `dragging` for its cursor. The same hook handles
  every type, so the behaviour is identical by construction.
- **Gesture listeners live on `window`** (installed only while a gesture is in flight) and the
  pointer is captured on the source element. If the element unmounts mid-gesture (remote delete),
  the listeners still see `pointerup`/`pointercancel` and end cleanly.
- **Dragging a selected object moves the whole selection** (PRD). `onObjectPointerDown` keeps the
  full selection when the target is already selected (no shift), instead of collapsing it to one.
- **Writes are rAF-throttled and flushed synchronously on `pointerup`/`pointercancel`**, so the
  committed position always matches the pointer release. Each gesture write is absolute (computed
  from the gesture's start rects), which makes concurrent gestures on disjoint selections merge
  cleanly (Yjs per-field LWW; different editors touch different objects).
- **`bringObjectsToFront`** raises the whole selection one step above the highest unselected
  object (stable rank), so a dragged group lands on top as one unit.
- **Resize policy comes from the registry spec**: `aspectLocked` stickies keep their ratio on
  every handle (edges drive one axis, corners take the larger ratio), while free types
  (testbox) resize per axis; all types clamp to `minSize`…`MAX_OBJECT_SIZE_WORLD`.
- **Remote changes prune the selection**: `useSelection` drops ids missing from the snapshot and
  clears `editingId` when its target vanishes (story 3's delete-while-editing behaviour is kept).
- **Escape is context-aware**: cancels an active marquee, otherwise clears the selection.
- **`useBoardDoc` rebuild**: objects flow through a `useLayoutEffect` observer + `useState`
  (not `useSyncExternalStore`, whose subscription installs in the passive-effects phase and left
  a window where doc writes could be missed under load — the root cause of the pre-existing
  component-test flakes; now 0 failures across 10 loaded parallel runs).

### Testing strategy

- **Unit (TC-01…15):** geometry (containment/union/normalize/resize/aspect/limits), board-model
  group ops (skip-missing, reject-non-finite, single transact, z-ranking, delete), registry
  (spec lookup, unknown type, duplicate throws), selection reducer (click/toggle/setMany/prune/
  edit/no-op stability).
- **Component (TC-16…31):** full-app tests with a fake y-websocket provider (the same
  `providerHolder` pattern as the load-failure test): marquee inside/half/outside, group drag
  moves only the selection, group drag of an already-selected note keeps the whole selection,
  resize handles (corner + edge, aspect-locked and free, min clamp), nudge (arrow + shift+arrow,
  no camera pan), Delete/Backspace, Ctrl+A, Escape (clear + marquee cancel), remote-delete
  pruning, load-failed = no writes on drag.
- **E2E (TC-32…36):** real wrangler dev + Chromium. Marquee half-overlap exclusion; 6-note group
  move above a 4th with corner resize scaling sizes *and* gaps + min clamp; arrow nudge of a
  selection (camera untouched) + group delete; cross-editor delete prunes a selection within the
  live-update budget; 5 simultaneous editors moving 5 different rows converge on identical
  positions.

### Test notes

- **`notesKey` was silently broken** (JSON.stringify replacer array strips nested properties —
  the replacer applies to nested objects too, so every note serialised to `{}` and every
  "convergence" comparison was trivially true). Fixed to sort by id and keep full note data.
  Story 3's live-collaboration checks now actually compare positions.
- **TC-36 convergence race:** with the broken key, the "all 5 contexts converge" poll resolved
  immediately and the position assertion read in-flight state (cross-context relay lags a few
  ms). With a real key the poll waits for genuine convergence; the test is stable across
  repeated runs.
- **E2E viewport is 1280×720** (the Chromium project uses `devices['Desktop Chrome']`, which
  overrides the global 1280×800). Screen = (world − camera) × zoom; initial camera
  (−640, −360, 1) ⇒ screen = world + (640, 360).
- **Seeding arbitrary sizes:** e2e seeds build a `Y.Doc` in the Node context (raw Y.Maps with
  exact top-left x/y and optional width/height) and apply the base64 update through
  `__vidi6.applyUpdates` — sticky 120×120 needs explicit width/height; omitting them gives the
  200×200 default.
- **`closeAll` takes rest args** (`closeAll(...participants)`), not an array.

---

# Story 8: Undo and redo my own changes without undoing anyone else's — Implementation Notes

## What was built

Undo and redo of *one's own* changes only, on a live board. Each participant runs a
per-`Y.Doc` `UndoManager` scoped to their local origin, so a Ctrl+Z reverts the editor's own
last change — never a collaborator's. A 500 ms capture window merges a burst (one drag, one
typing run) into a single step, and an explicit `boundary()` closes that window so two distinct
actions (drag then recolour) are two steps.

### Key files

| File | Purpose |
|------|---------|
| `src/client/board/undo.ts` | `createUndo(doc, opts?)` → `UndoController` wrapping Yjs `UndoManager`: `undo`/`redo`/`canUndo`/`canRedo`/`boundary`/`onChange`/`destroy`; `trackedOrigins: [LOCAL_ORIGIN]`, `captureTimeout`, `index: 0` stack |
| `src/client/board/useUndo.ts` | React subscription to the controller's change signal; exposes `canUndo`/`canRedo` (gated by `canEdit`) + `undo`/`redo` |
| `src/client/board/UndoButtons.tsx` | The two toolbar buttons (`aria-label`, `data-testid`, disabled state, inline SVG icons) |
| `src/client/board/Board.tsx` | Owns the controller (`useMemo` over `doc`), wires `boundary()` into gesture start/end, nudge, delete, create, colour, and text edits; registers the undo test hooks |
| `src/client/board/useBoardKeys.ts` | Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z and Ctrl/⌘+Y redo (after the `canEdit` guard, before the selection guard — undo/redo don't need a selection); `boundary()` around nudge + delete |
| `src/client/board/Toolbar.tsx` | Optional `canUndo`/`canRedo`/`onUndo`/`onRedo` props; renders `UndoButtons` when `onUndo` is provided |
| `src/client/board/SelectionBar.tsx` | Optional `onBoundary`; wraps `setStickyColor` so a recolour is its own step |
| `src/client/objects/StickyTextEditor.tsx` | Optional `onBoundary`/`onUndo`/`onRedo`; `boundary()` on mount + on end, and in-editor Ctrl/⌘+Z / Ctrl/⌘+Y intercept (so typing undo lives on the editor, not the board) |
| `src/client/objects/StickyNote.tsx` | Forwards `onTextBoundary`/`onTextUndo`/`onTextRedo` to its editor |
| `src/shared/config.ts` | `UNDO_CAPTURE_TIMEOUT_MS = 500`, `UNDO_MAX_STEPS = 200` |
| `src/client/canvas/testHooks.ts` | `registerUndoTestHooks`; `__vidi6.canUndo/redo/undo/redo/undoBoundary` (test-mode only) |

### Design notes

- **One manager per doc, scoped to one origin.** `UndoManager` is constructed with
  `trackedOrigins: [LOCAL_ORIGIN]`. Yjs records a transaction only when its origin matches, so
  remote (collaborator) transactions are *never* captured. That is the entire mechanism for
  "undo my changes, not theirs" — no diffing or filtering of captured items is needed.
- **`index: 0` keeps the undo stack at the head.** The redo stack is a separate, implicit
  reverse; `undo()` pops head, `redo()` re-applies. `depth: Infinity` so nested doc ops (a move
  touching x and y, a delete touching several objects) collapse into the single stack item for
  the transaction.
- **`captureTimeout` is the merge window.** Consecutive local transactions inside 500 ms merge
  into one stack item. A drag is one long gesture (many rAF writes) — all within the window — so
  it is one step. A typing burst (key-by-key inserts) is one step. Two actions ≥ 500 ms apart are
  two steps.
- **`boundary()` closes the window deliberately.** Called at gesture *end* (and around discrete
  commands: nudge, delete, create, recolour, text start/end). It flushes the current stack item
  so the next local transaction starts a fresh step. This is what makes "drag *then* recolour"
  two steps even though both may land within 500 ms of each other.
- **Undoing a move of a remotely-deleted object is a no-op that advances the stack.** When the
  inverse targets a deleted item, Yjs applies it to the (deleted) item with no visible effect and
  pops on to the next own step in the same `undo()` call. No throw; the deleted object stays
  gone. (TC-07 / TC-23.)
- **`onChange` is a change signal, not a Yjs doc event.** The controller subscribes to the
  manager's stack and fires on every `undo`/`redo`/capture so the toolbar can update
  `canUndo`/`canRedo`. `useUndo` converts that into a React re-render.
- **The controller lives in `Board.tsx`, not `App.tsx`.** The `Y.Doc` is owned by `useBoardDoc`
  inside `Board`, so the manager that wraps it is created there (`useMemo` over `doc`) and the
  controller is passed down. (The design doc says App; Board is where the doc actually exists.)
- **Editor keystrokes are intercepted before the board.** `StickyTextEditor`'s `keydown`
  handles Ctrl/⌘+Z and Ctrl/⌘+Y (and calls `preventDefault`) while focused, so typing undo is
  the editor's text undo — it never reaches `useBoardKeys`.
- **Read-only ESM export means real time in boundary tests.** Yjs captures `Date.now` at import
  (`lib0/time` `export const getUnixTime = Date.now`), which cannot be patched or faked. The
  capture-timeout unit tests therefore run on the *real* clock with comfortable margins on each
  side of the 500 ms threshold (see Test notes).

### Testing strategy

- **Unit (TC-01…13, `undo-history.test.ts` + `undo-boundaries.test.ts`):** own moves/edits are
  undoable; a remote peer's changes are never captured (a second `Y.Doc` pushes state in with a
  remote origin — `tests/unit/peer.ts`); undo/redo round-trips; multi-step history; the capture
  timeout merges a burst into one step and splits across the threshold; `boundary()` on an empty
  stack is safe; undo of a move on a remotely-deleted object is a no-op that advances; a remote
  text edit survives a local delete + undo.
- **Component (TC-14…21, `UndoBoundaries.test.tsx` + `UndoControls.test.tsx`):** a 30-frame drag
  is one step; move-then-colour is two; in-editor Ctrl/⌘+Z undoes typing not the move;
  `pointercancel` is one step; empty stacks disable the buttons; all five keyboard combos map to
  the right action with `preventDefault`; load-failed disables the buttons and ignores the
  shortcuts; Ctrl/⌘+Z while an `<input>` is focused never reaches the controller.
- **E2E (TC-22…24, `undo.spec.ts`):** real wrangler dev + Chromium. Mia deletes 8 while Raj adds
  a note — Mia's undo restores the 8 on *both* screens and leaves Raj's note intact, redo removes
  them again; Mia moves a note Raj deletes — her undo is a no-op with no error and the note stays
  absent on both; all 5 editors make and undo their own change concurrently — final boards
  identical and each own change reverted.

### Test notes

- **Fake timers cannot control Yjs's clock.** Because `getUnixTime` is a read-only ESM export
  bound to `Date.now` at import, `vi.useFakeTimers()` cannot move the capture-timeout clock. The
  boundary tests (TC-12/13) use the *real* clock: a typing burst with ~100 ms gaps (well under
  500 ms) merges to one step, while a ≥ 500 ms pause splits to two. This is a deliberate,
  documented deviation from the spec's "fake timers" wording.
- **`makeNote` in component tests is undo-tracked.** The test helper creates the note with
  `createSticky` under `LOCAL_ORIGIN`, so the create itself is a step on the (test) controller's
  stack. Component undo tests account for that create step (e.g. TC-19's sequence ends with the
  note's create being undone, then redone).
- **Buttons gate on `canEdit`; the test hook does not.** `hooks().canUndo()` returns the raw
  controller state, but the toolbar buttons render disabled when `!canEdit`. The load-failed test
  (TC-20) therefore asserts the *button* disabled state, not the raw controller — the edit lock
  is a UI gate, not a controller gate.
- **E2E counts must include synced remote notes.** After Raj creates a note in TC-22, it syncs to
  Mia's tab, so each screen shows 8 + 1 = 9 (not 8). The assertions compare against the specific
  seeded ids + Raj's id rather than a bare count to stay unambiguous.
- **`pageerror` listeners for "no error".** TC-23/24 attach `page.on('pageerror')` to every tab
  and assert the list is empty at the end, giving a real guarantee that undoing a doomed inverse
  (or 5 concurrent undos) throws nothing.

