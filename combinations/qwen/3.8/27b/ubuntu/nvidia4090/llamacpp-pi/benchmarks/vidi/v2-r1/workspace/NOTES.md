# Story 2 — Notes

## Story 1 gaps filled to support Story 2

Story 1 (pan/zoom) was scaffolded but had no committed, runnable app. The
following were added so Story 2 has a working surface to build on:

- **Vite + TypeScript + Vitest + Playwright toolchain** (`package.json`,
  `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
  `playwright.config.ts`, `index.html`). The e2e dev server runs with
  `--mode test` so `window.__vidi6` test hooks are installed.
- **App shell** (`src/client/main.tsx`, `src/client/App.tsx`) mounting the
  board under React 19 StrictMode, plus base layout styles
  (`src/client/styles.css`).
- **Camera model and hook** (`src/client/canvas/camera.ts`,
  `useCamera.ts`) with `screenToWorld` / `worldToScreen` and the
  `--mode test` test hooks (`src/client/testHooks.ts`) that expose the
  in-memory `Y.Doc`, camera get/set, and `getNotes()` for e2e assertions.
- **BoardViewport** pan/zoom input (drag-pan, non-passive wheel, Ctrl/Cmd
  keyboard shortcuts, Safari gesture) and the world layer that hosts board
  objects; **ZoomControls**, **NavigationHint**, and the **Toolbar** (the
  Sticky note button lives here).

## Key design decisions

- **All board content lives in a `Y.Doc` from day one.** `useBoardDoc`
  owns one in-memory `Y.Doc`; story 3 will attach a network provider and
  story 4 persistence to the same document. No note data is kept in React
  state.
- **`useBoardDoc` exposes an immutable snapshot via `useSyncExternalStore`.**
  A `dirty` flag is set by `objects`-map `observeDeep`; `getSnapshot`
  recomputes the frozen array only when dirty and returns the cached array
  otherwise (satisfies the "stable reference until change" contract). On
  (re)subscribe the store is marked dirty once so a mutation that landed
  before the observer attached is still picked up.
- **DOM order is independent of stacking z.** `snapshot()` returns notes
  sorted by z (asserted by unit tests), but `App` renders them in a stable
  id order and each note uses CSS `z-index`. Coupling DOM order to z would
  make React *move* the dragged note's element when `bringToFront` raises
  its z, which drops the active pointer capture and aborts the drag
  (this was a real e2e failure at 200% zoom).
- **`createSticky` centres the note on the world point** (top-left =
  point − `STICKY_SIZE_WORLD`/2), so a double-click creates the note
  centred exactly under the cursor at any zoom.
- **Text editing uses a minimal Y.Text diff** (common prefix/suffix,
  code-point safe) and clamps to the length limit; font auto-fits to the
  largest size that fits, clamped to a minimum, with a bottom fade when
  overflowing.
- **Pointer interactions are idempotent and unmount-safe**: drags
  no-op if the note is removed mid-gesture, and scheduled rAF moves are
  cancelled on unmount.

## Environment notes (test reliability)

- **jsdom (Vitest) has no `PointerEvent` or `ResizeObserver`.** The
  component test setup polyfills both (`tests/setup/component.ts`).
- **Yjs `Y.Text` must be doc-backed in unit tests**; a standalone
  `new Y.Text()` does not behave like a type attached to a document.
  Helpers build text through a real `Y.Doc`.
- **E2E module-transform pre-warm.** The first page load of a Playwright
  run triggers on-demand Vite transforms for the whole module graph, which
  on a loaded machine can push the first render past the test timeout and
  flake the suite. `tests/e2e/global-setup.ts` fetches every source module
  through the dev server before tests run; `beforeEach` also waits for
  `#board-root` to be visible before any interaction.
- **Ports 28432–28447** are reserved for this task; the e2e web server uses
  28432.

# Story 5 — Notes

Story 1 gaps filled: none were needed for this story (the only pre-existing
gaps were already closed in stories 2–4).

## Key design decisions

- **Boards must exist before a link opens them.** `POST /api/boards` mints a
  22-char id (`src/shared/board-id.ts`: URL-safe alphabet, 128 bits of
  randomness, collision check) and calls the room's `initialize()` RPC,
  which stamps `storage_meta.created_at` in DO SQLite. `GET /api/boards/:id`
  and the WS upgrade gate both use `BoardStore.existsReadOnly()` — a pure
  read of `sqlite_master` + row counts that never creates tables, so
  probing a mistyped link leaves no storage behind.
- **Lazy, idempotent migration.** `BoardStore.migrate()` no longer runs at
  construction; it runs from `initialize()` and lazily before the first
  `append()`. `load()` treats missing tables as an empty board (reads only).
  This is what lets unknown-board probes stay side-effect free while
  existing boards (including legacy ones) keep working.
- **Legacy boards (pre-story 5).** A board with data rows but no
  `created_at` is still "existing": `existsReadOnly()` checks table names
  and row counts, not just the meta stamp. The `seed-legacy` test hook
  writes an `updates` row without the stamp to prove this path (TC-31 e2e,
  integration). The hook is special-cased in `BoardRoom.fetch` (it must
  reload the room after the write) rather than routed through
  `handleTestHook`.
- **Client routing without a router library.** `src/client/router.ts` is a
  tiny `useSyncExternalStore` over `history.pushState` + a
  `vidi6:routechange` event (cached snapshot, re-parses only when the
  pathname changes). `App` is the router shell; `HomePage` (`/`),
  `BoardPage` (`/b/:id`) and `NotFoundPage` (`/b/<malformed>` and any
  unrecognised path) are the pages.
- **Existence check with retry/backoff.** `BoardPage` runs
  `checkBoard()`; `unreachable` (network failure, not HTTP 404) retries
  with doubling backoff from `BOARD_CHECK_RETRY_BASE_MS` (1 s, capped),
  showing “Couldn't reach vidi6. Retrying…”. `not_found` goes straight to
  the not-found page. `nextBoardPageState()` is a pure, tested state
  machine; the `ready` state carries an empty `boardId` and `BoardPage`
  overwrites it with its own id (documented in `state.ts`).
- **Share link is `${origin}/b/<id>`**, built in the browser
  (`boardLink()`, `src/client/share/SharePanel.tsx`). Copy uses
  `navigator.clipboard.writeText`; on rejection or a missing clipboard API
  the panel selects the full link in a read-only input and shows
  “Press Ctrl+C (Cmd+C on Mac) to copy”. “Link copied” shows for
  `LINK_COPIED_MS` (2 s) then reverts; the timer is cleared on close so a
  reopened panel never shows a stale confirmation.
- **`<meta name="referrer" content="no-referrer">`** in `index.html`: a
  shared link must not leak the sharer's URL to the recipient's network
  requests (the board id is the only shared secret).
- **Compatibility date** bumped to `2025-06-01` in both wrangler configs
  (needed for the SQLite `sqlite_master` query used by `existsReadOnly()`
  semantics we rely on).

## Test notes

- **Component tests mock the api boundary once, in the setup file**
  (`tests/setup/component.ts` `vi.mock`s `src/client/api` with defaults);
  pages tests then `mockReset()` + re-stub per test. `renderApp()` is async
  because a board mounts after the existence-check microtask, and the
  y-websocket provider is stubbed so boards mount offline in jsdom.
- **`scripts/ensure-dist.mjs`** is the integration project's globalSetup:
  builds `dist/client` (production mode) when missing, since integration
  tests serve the Worker's static assets from `dist/`. Kept dependency-free
  and annotation-free (Vitest's .mjs parser rejects TS annotations).
- **The Vite dev plugin keeps an in-memory board map** for `/api/boards`
  (any valid id → exists) — pre-story-5 semantics are enough for the
  sticky-notes/collaboration suites; real 404s and the legacy path are
  proven against wrangler in `tests/e2e/share.spec.ts`.
- **Share e2e runs its own wrangler per test** (new config
  `playwright.share.config.ts`, script `test:e2e:share`); the main
  Playwright config ignores `share.spec.ts`. Clipboard is exercised for
  real in TC-26 (context `permissions: ['clipboard-read', 'clipboard-write']`
  + `navigator.clipboard.readText()`), blocked via `addInitScript` in TC-29.
- **Existing wrangler specs now create their boards through the API**
  (`persistence.spec.ts` TC-19/TC-20), since unknown ids no longer open.
  `sticky-notes.spec.ts` navigates to `/b/<fresh id>` instead of `/`.
- **Fake-timer component tests** (`TC-21`, `TC-22`) wrap
  `vi.advanceTimersByTimeAsync` in `act(async () => …)`; RTL's `findBy*`
  must not be used while timers are faked.

# Story 7 — Notes

## Story 1 gaps filled

None. Pan/zoom (story 1) was already working: the marquee and transform
input both build on `useCamera`'s existing drag handling, and the
Ctrl/Cmd+A keyboard shortcut path was added next to the existing
Ctrl/Cmd +/-/0 zoom shortcuts in `useCamera`/`BoardViewport`.

## Key design decisions

- **One generic path for every type.** Selection, move, resize and delete
  live in `useSelection` / `useTransformGesture` / `useBoardKeys` + the
  group functions in `board-model.ts`; the per-type surface is the
  `ObjectTypeSpec` in `registry.tsx` (`Component`, `resizable`,
  `aspectLocked`, `minSize`, `editableText`, `hitTest`). `StickyNote`
  keeps story 2's rendering but delegates pointerdown to the board and
  renders explicit `width`/`height` (falling back to `STICKY_SIZE_WORLD`).
- **`selectionReducer` `edit` does not require the id to be present.**
  A freshly created note is edited in the same tick in which it enters the
  document (before any snapshot render), so the reducer accepts the id and
  the snapshot effect's `prune` reconciles later (drops it if it was
  deleted). Making `edit` snapshot-validated forced a deferred
  start-edit (pending ref + effect) that added a render cycle; the
  deferred focus then lost the race against `keyboard.type` in e2e
  (story 2 TC-32 went flaky ~50%). Restoring the synchronous `startEdit`
  made it pass 5/5 and the full main e2e suite twice in a row.
- **`resizeRect` anchors at the opposite edge/corner of the handle**, and
  the aspect lock keeps the ratio of the *current* box (not the start box)
  so repeated frames stay consistent; `clampScale` computes one uniform
  scale from all selected rects + per-type min sizes, and `scaleWithin`
  maps each child from its start rect into the resized bounding box.
- **Move/nudge writes are absolute** (`moveObjects` sets `x`/`y`), so
  concurrent editors converge on the last writer's absolute position
  (TC-36). `bringObjectsToFront` runs once at gesture start so the DOM
  order/CSS z-index split from story 2 never moves the dragged element
  mid-capture.
- **Handles are screen-space.** `SelectionOverlay` computes the bounding
  box from `unionRects` in world units but sizes the 8 handles by
  `HANDLE_SIZE_PX / zoom` world units, so they stay a constant size on
  screen at any zoom (e2e asserts the 16px box at 200% zoom).
- **The marquee is additive** (`setMany(ids, true)`) per design, so a
  Shift+drag grows the current selection; empty results leave the
  selection unchanged. pointercancel/Esc cancel with no change.
- **Selection is local UI state** — never written to the Y.Doc; only the
  object transforms are shared.

## Test notes

- **Test-only `testbox` type** (`tests/fixtures/testbox.tsx`):
  resizable, not aspect-locked, `minSize` 10. Registered at module import
  of the test file only; proves the generic path (edge handle changes one
  axis, no ratio lock) that stickies can't show.
- **Component harness for gestures** (`tests/component/harness-gesture.tsx`)
  renders a real `BoardViewport`-shaped world layer with pointer-captured
  synthetic `PointerEvent`s (jsdom polyfill) so `useTransformGesture` / marquee
  are tested through their real pointer handlers, not re-implemented logic.
- **E2E runs against two servers.** The main Playwright config (dev +
  vite-plugin-board-sync WS relay) covers TC-32/33/34 in chromium; the new
  `playwright.selection.config.ts` (script `test:e2e:selection`) runs the
  wrangler-based TC-35/TC-36, matching the story 5 share-spec pattern.
  The main config's `testIgnore` excludes `selection-collab.spec.ts` so a
  plain `npm run test:e2e` never needs wrangler.
- **Firefox/WebKit skipped for TC-32.** `tasks.md` asks for TC-32 in all
  three browsers, but only Chromium is installed in this environment
  (`npx playwright install --dry-run` shows firefox/webkit absent); the
  harness constraint is Chromium-only. All TC-32/33/34/35/36 cases pass in
  chromium.

# Story 8 — Notes

## Key design decisions

- **yjs 13.6.33's UndoManager exposes no `undoDepth`/`redoDepth`**, so the
  `UNDO_MAX_STEPS` trim (undo.limit) is manual: on `stack-item-added`, drop
  oldest entries while the stack is longer than the limit. Guarded by
  `!manager.undoing` so a trim never races an in-flight inverse.
- **Dead steps are detected before the pop, then discarded.** yjs's own
  `undo()` auto-pops the *next* stack item when the current inverse has no
  effect — that cascade both breaks "one press = one meaningful step" and
  could run across steps whose targets a colleague deleted. The controller
  instead peeks at the top item, decides whether its inverse would have an
  effect (mirror of yjs's `undoItem`/`redoItem` rejection paths, plus a
  read-only walk of the DeleteSets), and if not, removes the item from the
  stack *without* applying it (`popNoEffect`). Discarding (not re-inserting
  the un-inverted item) is deliberate: re-insertion ping-pongs the stack.
  `meta.removed.size > 0` always counts as an effect (a restore of
  top-level entries has no right-chain conflict); `meta.touched.size === 0`
  is treated as an effect defensively.
- **`walkDeleted` (custom, read-only) replaces `Y.iterateDeletedStructs`.**
  yjs's walker *splits* items — a mutation of the struct arrays that is only
  valid inside a committed transaction (it relies on `transaction._mergeStructs`).
  The controller needs the same ranges for a pure read, so it walks each
  client's struct array directly, yielding structs overlapping each deleted
  range without splitting.
- **`createNoteAt` is boundary-bounded** (one creation = one undo step, as
  through the UI), so e2e TC-22's "drain the history" loop presses 12 times
  (1 redo'd delete step + 8 creation steps, with margin for no-op presses).

## Test notes

- **`lib0/time`'s `getUnixTime` is `Date.now` captured at import time**, so
  `vi.useFakeTimers()` cannot reach it. The boundary unit tests
  (`tests/unit/undo-boundaries.test.ts`) mock the module itself:
  `vi.mock('lib0/time')` with a `vi.hoisted` controllable clock, and the
  *unit* vitest project inlines `yjs` and `/lib0\//` (`server.deps.inline`)
  so the mock applies to yjs's internal `require('lib0/time')`.
- **E2E assertions about a remote page must poll.** A local undo only
  reaches other contexts after worker propagation; TC-23 originally asserted
  on Raj's page immediately after Mia's Ctrl+Z and lost that race (flaky
  "B still present"). All cross-context checks now use `expect.poll`.
- **The marquee uses the fully-inside rule** (`objectsInRect` →
  `rectContains`), so TC-22's box must fully cover the largest seeded note
  (world −460..475 × −160..195 → screen 140,180 → 1160,640, viewport
  1280×800).
- **Every e2e test closes its browser contexts in `finally`.** A mid-test
  failure otherwise leaks contexts whose pages keep reconnecting to the
  *next* test's wrangler (all wranglers share port 28433), which pollutes
  the next test with 404s and "Reconnecting" states and can make its keys
  land while `canEdit` is false.
- **TC-24 inserts a 700 ms pause between the move loop and the typing
  loop** (> `UNDO_CAPTURE_TIMEOUT_MS` = 500) so each editor's move and
  typing remain separate undo steps; the intermediate assertion (typings
  reverted, moves intact) depends on that.
- **`useUndo`** builds its snapshot as a short primitive string
  (`useSyncExternalStore` requires a stable `getSnapshot`) and ref-caches
  the API object keyed by that snapshot.
- **The editor owns its own undo/redo shortcuts** (Ctrl/Cmd+Z,
  Ctrl/Cmd+Shift+Z, Ctrl+Y) with `preventDefault`, routed through the board
  controller, so the textarea's native undo history never diverges from
  Y.Text; after a shortcut it re-syncs the textarea from Y.Text.
- **E2E config** `playwright.undo.config.ts` (script `test:e2e:undo`):
  chromium only, one worker, 240 s timeout, each test starts its own
  wrangler on 28433. The main config's `testIgnore` excludes
  `undo.spec.ts` so a plain `npm run test:e2e` never needs wrangler.

# Story 9 — Notes

## Key design decisions

- **Text objects live in the shared model** (`src/shared/objects/text.ts`): a
  `Y.Map` type `text` with `id`, `createdBy`, `x`, `y`, `text` (a `Y.Text`),
  `size` (S/M/L/XL), `width` (world px, the fixed box width) and `widthMode`
  (`auto`|`fixed`). Every write transacts with `LOCAL_ORIGIN` so the board
  UndoController tracks them; reads are plain getters. `createText` centres on
  the click point like `createSticky`.
- **The wire schema is framework-free.** `board-model.ts` reads `size`/`width`/
  `widthMode` generically into `ObjectSnapshot` (validating `size` against
  `TEXT_SIZES`) so the snapshot, marquee hit-test and resize path treat a text
  object like any other box; the text editor and layout are client-only.
- **Layout (`src/client/objects/textLayout.ts`) uses a canvas 2D measurer**
  (`measureText`, DPR-scaled) with greedy word wrap on spaces (long words
  overflow, never char-split). There is **no horizontal padding (P=0)**: the
  box width is `min(longest original line, TEXT_MAX_AUTO_WIDTH_WORLD=600)` for
  auto, and the fixed `width` for fixed mode; the wrap budget equals that
  width, so wrapped lines fit the CSS content width exactly. Height is
  `lines × fontPx × TEXT_LINE_HEIGHT(1.3)`.
- **`useTextBoxSync` re-measures on a LOCAL_ORIGIN observer** that is key
  filtered with `keysChanged.has(...)` (yjs 13.6.33's `YMapEvent` exposes
  `keysChanged: Set<string>`, not `keys`). It reacts only to `size`/`width`/
  `widthMode` key changes and to Y.Text changes — an `x`/`y` move never triggers
  a spurious box write. Box writes go through `setTextBox` (LOCAL_ORIGIN), so
  a keystroke + its re-measure merge into one undo step.
- **`TextEditor` is the single general editor** (`src/client/objects/TextEditor.tsx`);
  `StickyTextEditor` is a thin wrapper that keeps story 2's font-fit +
  character counter by passing `onValueChange`/`textareaRef`. The `undo`
  prop is the minimal `TextEditorUndo` interface (boundary/undo/redo), which
  the board `UndoController` satisfies structurally — no circular import.
- **Concurrency (text.concurrent): the textarea mirrors Y.Text and never owns
  the value.** The textarea is *uncontrolled*. Local keystrokes commit with
  `applyTextDiff(ytext, ta.value, LOCAL_ORIGIN)` (skipped by the observer since
  the origin matches). A `ytext.observe()` handler re-syncs the textarea from
  Y.Text for every non-LOCAL_ORIGIN change — remote sync **and undo/redo**
  (the UndoManager's inverse uses its own origin) — and moves the caret through
  the event delta with `mapCaretThroughDelta`. This keeps the invariant
  "textarea content == committed Y.Text" so two clients editing the same text
  both keep every character (the earlier whole-value diff lost remote
  characters when a stale textarea re-committed).
- **Tool mode (`src/client/board/useTool.ts`)**: `Select`(V) / `Text`(T) /
  `Sticky note`(N) / Escape→Select. The Text tool sets a crosshair cursor and
  `BoardViewport`'s `onPointerDownCapture` intercepts every pointerdown to
  `createTextAt` + start editing + drop back to Select (a plain click, no
  double-click, is required so it never collides with sticky creation).
- **Horizontal-only resize.** The registry spec gains `handles?: 'all'|
  'horizontal'`; text is registered `handles:'horizontal'`, `minSize:
  TEXT_MIN_WIDTH_WORLD`, `aspectLocked:false`. `SelectionOverlay` renders only
  the e/w handles for an all-horizontal selection, and `useTransformGesture`
  special-cases a single text object so dragging an edge writes `width` via
  `setTextWidthFixed` (switching to fixed mode) rather than scaling height.
- **Empty text is deleted on edit end.** `isEmptyText` is `length === 0`;
  whitespace-only text is kept. `BoardPage`'s end-edit handler calls
  `deleteIfEmpty` when the object still exists and is empty.
- **`createdBy`** is a per-tab anonymous id backed by
  `sessionStorage` (`src/client/client-id.ts`); real identity is story 6 (out
  of scope).

## Test notes

- **Test-first tasks 1, 3, 5, 7, 9, 10.** Unit: `text-model.test.ts`
  (TC-01..06), `text-layout.test.ts` (TC-07..11, TC-32) with a fake measurer,
  `caret-delta.test.ts` (caret mapping). Component: `TextBoxSync.test.tsx`
  (TC-12/13 + transition), `Tool.test.tsx` (TC-14..18), `TextObject.test.tsx`
  (TC-19..25). The text object must be registered in the *unit* project too —
  `registerKnownObjectType('text')` at module scope — because `objectsSnapshot`
  filters by `knownObjectTypes` (sticky-only by default).
- **E2E runs under wrangler** (`playwright.text.config.ts`, script
  `test:e2e:text`): chromium + firefox, one worker, no parallelism, 240 s
  timeout; the main config's `testIgnore` excludes `text.spec.ts` so a plain
  `npm run test:e2e` never needs wrangler. TC-26 (long-annotation wrap) runs in
  both browsers; TC-27..31 are chromium-only (handle drag, golden path,
  concurrency, capacity, abandoned text) because pointer-driven resize and the
  two-context concurrency case are the flakiest under a second engine.
- **WebKit cannot run in this environment.** The Playwright webkit build is
  downloaded but fails to launch: it needs the system library `libavif13`,
  which is absent, there is no root/sudo to install it, and the apt mirror
  (`archive.ubuntu.com`) is unreachable. Only chromium and firefox launch;
  both are used to satisfy the multi-engine requirement.
- **TC-29 (concurrency) pins the invariant.** Two contexts type into the same
  text ("alpha" / "beta" appended to "Head"); the assertion is a *multiset*
  equality (every typed character present exactly once, none lost or doubled)
  plus convergence of both screens — it deliberately does not require a
  specific interleave order. Expected total length is 13 (Head=4, alpha=5,
  beta=4).
- **Existing sticky-note tests reference the button by its new
  `aria-label` "Sticky note (N)"** (the Toolbar now shows the N shortcut);
  `sticky-notes.spec.ts`, `load-failure.test.tsx`, `Toolbars.test.tsx` and
  `broken-board.spec.ts` were updated to match.

# Story 10 — Notes

## Key design decisions

- **New model + geometry modules (pure, shared).** `src/shared/objects/shape.ts`
  (create by drag / click / Shift-square, style validation clamped to the
  palette, label via a `Y.Text`), `src/shared/objects/connector.ts`
  (endpoints, `setConnectorEndpoint`, `detachConnectorsTo`), and
  `src/shared/geometry/connector-geometry.ts` (`nearestSide`, `sideAnchor`,
  `resolveEndpoints`, `endpointAnchor`) + `src/shared/geometry/polyline.ts`
  (point-segment distance for the hit test). All are framework-free so the
  same code runs in unit tests, the client, and (for assertions) the e2e page.
- **Two-pass `objectsSnapshot`.** Pass 1 collects object rects; pass 2 derives
  each connector's bbox and resolved `fromPoint`/`toPoint` from the current
  rects so the arrow always sits on the midpoint of the nearest side of the
  object it is attached to (connector.follow). `ObjectSnapshot` gained
  `kind/fill/stroke/label` (shapes) and `from/to/fromPoint/toPoint`
  (connectors).
- **Delete detaches, never deletes, arrows.** `deleteObjects` calls
  `detachConvertersTo` (→ `detachConnectorsTo`) *before* removing the object:
  any attached endpoint becomes a **free** endpoint at the object's current
  side anchor (computed from the live rect, not the stored fallback). The
  arrow itself is always kept. This is what makes TC-26 (delete B → free end
  where B's side was, both screens) and TC-27 (delete race) hold.
- **Re-attach drag reads live state (TC-27).** The end-handle drag registers
  window `pointermove`/`pointerup` listeners **once** on pointerdown, but a
  remote delete can land while the pointer is held. If `finish` read the
  pointerdown-time snapshot it would re-attach to an already-deleted object.
  `ConnectorObject` keeps `latestSnapshot/Camera/Rects/Obj` refs (updated every
  render) and reads them at release, so a deleted target resolves to
  `objectAtPoint → null` and the end detaches to a **free** point at the
  release location, with no console error.
- **Active tool hook.** `src/client/tools/useActiveTool.ts` replaces the story 9
  `useTool` hook (deleted). It owns the tool + shape-kind state, the V/T/N/S/L
  shortcuts, and returns to Select after a shape/connector is created (Escape
  also returns from shape/connector). Shape/connector tools mount/unmount from
  `BoardPage` on tool change; unmount drops an unfinished drag (no create).
- **Connector hit test is zoom-aware.** The registry `hitTest` gained a third
  `zoom` argument (screen-pixel tolerances: `CONNECTOR_HIT_TOLERANCE_PX /
  zoom`). Existing sticky/text object types stay 2-arg (compatible).
  `objectAtPoint(snapshot, point, zoom)` is used by the tools and the
  re-attach release.
- **`selectOnly` action.** `useSelection` gained `selectOnly(id)` (no presence
  check) so a tool-created object becomes the sole selection in the same tick
  it enters the doc, before any collaborative sync.

## Test notes

- **Unit (test-first).** `shape-model.test.ts` (TC-01..06),
  `connector-model.test.ts` (TC-07..14, TC-29 detach), `geometry.test.ts`
  (nearestSide/sideAnchor/resolve/endpoint + polyline distance),
  `registry.test.ts` (3-arg hitTest, objectAtPoint).
- **Component.** `useActiveTool.test.tsx` (TC-22), `ShapeTool.test.tsx`
  (TC-15/16/17/28), `Connector.test.tsx` (TC-18..21). TC-20 (hit-test
  boundary) calls `getObjectType('connector').hitTest(snap, point, zoom)`
  directly because jsdom cannot do SVG geometry hit-testing.
- **E2E (`playwright.shapes.config.ts`, script `test:e2e:shapes`).** Chromium +
  firefox, one worker, no parallelism, 240 s timeout, **no shared webServer** —
  each test starts/stops its own `wrangler dev` on `WRANGLER_PORT` (so the fixed
  port never collides). The main `playwright.config.ts` `testIgnore` now also
  lists `shapes.spec.ts` and `connectors.spec.ts`, so a plain `npm run
  test:e2e` never needs wrangler.
  - **TC-23** (real drag at 100% → 200×120 at the dragged rect, ±1 world unit)
    runs in **chromium and firefox**. **TC-24** (200% diamond click → 160×160
    centred; long label wraps and stays centred after a handle resize) and the
    collaborative connector tests **TC-25..27** are **chromium-only**.
  - **Seeding** goes through the in-page `__vidi6` hooks (`seedCheckoutFlow`
    → `createShape`/`setShapeLabel`/`createConnector`), which call the real
    model functions in the page's own Y.Doc, so both collaborators start from
    the same board. The hooks only exist in `--mode test` builds; `openBoard`
    now `waitForFunction` on `window.__vidi6` so `page.evaluate` never races the
    install.
  - **Camera is local per client** (not in the shared doc), so every
    pointer-driven test pins it to the origin first (`setCamera({x:0,y:0,
    zoom:1})`) so world == screen.
  - **TC-25 delivery time is logged, not asserted.** The time from Dana's
    action to Sam's screen reflecting it (attach, and side-switch after B is
    dragged past A) is measured and logged against
    `LIVE_UPDATE_LATENCY_BUDGET_MS` via `console.log` + a test annotation. It is
    deliberately **not** asserted, per the task.
  - **TC-27 race is forced deterministically.** Rather than a websocket route
    delay (Playwright `route` cannot delay WS *frames*, only the handshake),
    Dana grabs the `to` handle, drags it over B and **holds** the pointer there
    while Sam deletes B; the test waits for the delete to reach Dana, then Dana
    releases. The release reads the latest snapshot → target is gone → the end
    detaches to a free point. Asserts the arrow is visible with a free end and
    **no** `pageerror`/console errors.

## Environment

- **WebKit unavailable.** The Playwright webkit build is present but fails to
  launch: it needs the system library `libavif13`, which is absent, there is no
  root/sudo to install it, and the apt mirror is unreachable. `TC-23` therefore
  runs in **chromium + firefox** only; the "and webkit" part of the TC-23
  requirement cannot be satisfied on this host. Chromium + firefox cover the
  multi-engine intent (different rendering/pointer engines).

# Story 11 — Notes

## Key design decisions

- **Viewport routing without touching BoardViewport.** The design lists
  BoardViewport as "modified" so that, while the Pen tool is active, pointer
  drags route to PenTool instead of panning or moving objects. Like
  ShapeTool (story 10) and ConnectorTool, this is achieved by PenTool's own
  **capture-phase** `window` `pointerdown` listener: it fires before the
  event reaches the React root, and `stopPropagation()` prevents both the
  viewport pan and any object gesture (including gestures starting over an
  existing object — TC-28-style, verified e2e in TC-19). BoardViewport's
  wheel/pinch handlers are untouched, so scrolling still pans and
  Ctrl/Cmd+scroll still zooms (pen.navigation, TC-19).
- **PenTool takes `canEdit` and `undo` props beyond the design contract.**
  The contract's `{camera, color, thickness, doc, identityId}` is a subset;
  the edit lock (story 4) and the per-board undo controller (story 8, one
  commit = one undo step via `undo.boundary()`) are wired in the same way as
  ShapeTool/ConnectorTool. `identityId` is the client id (`getClientId()` in
  BoardPage), recorded on each stroke.
- **StrokeObject takes `ObjectProps`, not `{stroke, selected}`.** The design
  contract idealises the props; the registry (stories 9–10) hands every
  object component the common `ObjectProps` bundle, so StrokeObject follows
  the ConnectorObject pattern and narrows `obj` to `StrokeSnap` internally.
- **Commit on `pointercancel`/`lostpointercapture` keeps the points drawn so
  far** (pen.interrupted, TC-11) — unlike ShapeTool, which discards an
  interrupted drag. A single bare press interrupted before any move commits
  a dot.
- **Unfinished drag on unmount is dropped.** Escape or another tool
  unmounts PenTool; the window listeners are removed in the effect cleanup,
  so a later (implicit) `lostpointercapture` never reaches a handler and
  nothing is created (TC-13).
- **Preview is rAF-throttled and local-only.** Points are appended on every
  pointermove (including `getCoalescedEvents()` payloads) but the preview
  path state updates at most once per animation frame (pen.tool). The
  preview is a fixed full-viewport SVG overlay (screen coordinates, no
  viewBox) that is never written to the Y.Doc — so in-progress strokes are
  invisible to other participants (TC-18). The round cursor (diameter =
  thickness × zoom, follows the pointer over the viewport, `aria-hidden`)
  is positioned via direct DOM writes on a ref to avoid a re-render per
  mouse move.
- **STROKE_MAX_POINTS split shares the join point.** When a part reaches
  5,000 recorded points it is simplified and committed and the next part
  starts from the same last point, so consecutive strokes join with no
  visible gap (TC-12). RDP always keeps first/last, so the join point
  survives simplification on both sides.
- **Dot commit.** A press/release with movement below `DRAG_THRESHOLD_PX`
  (3, story 2's setting) commits one point; `createStroke` gives it a
  thickness-square bbox and it renders as a round-capped zero-length
  subpath (TC-04, TC-10).
- **Hit test falls through to objects below.** The registry `hitTest` is
  `distanceToPolyline(scaledPoints(s), p) <= max(thickness/2,
  STROKE_HIT_TOLERANCE_PX/zoom)`; the StrokeObject's clickable surface is an
  invisible wide hit path exactly 2× that tolerance (never the bbox), so a
  click inside the bbox but far from the line selects the object below
  (TC-16).
- **Aspect-locked resize reuses story 7.** The registry entry sets
  `resizable: true, aspectLocked: true, minSize: STROKE_MIN_SIZE_WORLD`; the
  drawn line scales because the component renders `scaledPoints` (points
  scaled by current size / base size), while `stroke-width` stays the stored
  thickness (TC-06, TC-20).
- **E2E matrix: chromium + firefox.** TC-17 (draw + live preview) runs in
  chromium and firefox; TC-18 to TC-20 are chromium-only (skipped in
  firefox via `chromiumOnly()`, the story-10 pattern). Webkit is unavailable
  on this host (missing `libavif13`), so the "and webkit" part of TC-17's
  requirement cannot be satisfied here.
- **TC-17 samples the preview `d` during a real drag** (24 loop moves, one
  `page.$eval` per move) and asserts the path is present and its `d`
  changes between samples; the stroke persists after release and the
  preview is gone. The delivery time in TC-18 is logged against
  `LIVE_UPDATE_LATENCY_BUDGET_MS` (annotation + console) and never asserted.
- **Test hooks** gained the stroke fields on `Vidi6ObjectInfo`
  (`points`, `baseWidth`, `baseHeight`, `thickness`); `ObjectSnapshot`
  gained the matching optional fields and `objectsSnapshot` parses the
  stroke's stored array (validated: non-empty, finite, even-length).
  `tests/e2e/shape-helpers.ts`'s `ObjectInfo` gained the same optional
  fields (no impact on the story-10 specs).

# Story 12 — Notes

## Environment

- **WebKit is unavailable on this host** (missing system library
  `libavif13`, no root to install it). The e2e matrix is chromium +
  firefox: TC-25 (drop → placeholders → ready on two screens) runs in both;
  TC-26 to TC-28 are chromium-only (skipped in firefox via `chromiumOnly()`,
  the story-10/11 pattern).
- **jsdom's `File` has no `arrayBuffer()`.** The `createImageBitmap` stub in
  `tests/setup/component.ts` therefore cannot read the file's bytes; instead
  `fileFromBytes` (tests/fixtures/images) stashes the decoded dimensions of
  complete-PNG fixtures on the File under a non-enumerable
  `FIXTURE_DIMENSIONS` symbol, which the stub reads. Files without the
  symbol (disguised PDFs, corrupt PNGs, JPEGs) are rejected, mirroring a
  browser decode failure — which is what maps them to the type message.
- **A dropped `img onError` is per-instance state** (TC-23): the
  "Image unavailable" box appears on the same mounted component after
  `fireEvent.error(img)`; re-mounting resets it.

## Bugs found while wiring the e2e matrix

- **The pure-JS PNG encoder wrote stored-deflate block headers in the wrong
  endianness.** `zlibStored` reused the PNG-order (big-endian) `u16` for the
  block's LEN/NLEN, but deflate requires little-endian there. Most sizes
  failed in the browser ("The source image could not be decoded") while a
  few (width 300) happened to survive Skia's tolerance — TC-25 initially
  produced one image plus a spurious type toast instead of three. Fixed with
  a little-endian `u16le` for the block headers only (IHDR/chunk lengths and
  CRCs stay big-endian). Verified against a byte-for-byte Python reference
  (PIL-decodable) and in-browser decoding of every fixture size.
- **`route.fulfill` must not forward raw response headers** (e.g.
  `transfer-encoding`) — TC-25's upload-delay helper re-fulfils with
  `status` + `contentType` + body only, or the XHR errors and every upload
  fails instantly.
- **`wrangler.e2e.jsonc` was missing the R2 binding**, so
  `env.ASSETS_BUCKET` was `undefined` in the e2e wrangler dev process and
  every upload returned 500. Added (R2 is emulated locally by `wrangler
  dev`); `handleUpload` still degrades to 500 when the binding is absent.

## Gap filled from story 11

- **The main e2e config never ignored `pen.spec.ts`**, so the multi-context
  pen tests (TC-18, TC-20) ran against the vite in-memory relay — where
  they cannot pass (the spec creates its board on its own wrangler).
  Reproduced on the story-11 baseline commit. Following the config's
  existing convention, `pen.spec.ts` (and the new `images.spec.ts`) are now
  in the main config's `testIgnore`; both keep running under their own
  wrangler configs (`test:e2e:pen`, `test:e2e:images`).

## Key decisions

- **JPEG fixtures are a JFIF header plus deterministic padding.** Nothing in
  the product decodes a JPEG: the server sniffs magic bytes only, the client
  rejects over-limit files before decoding, and a decode failure maps to the
  type message — so a decodable body would add nothing.
- **E2E drops are synthetic `DragEvent`s carrying a constructible
  `DataTransfer` of in-page-constructed Files** (`tests/e2e/drop-files.ts`);
  Playwright cannot drag OS files, but the client path (drop → validate →
  `createImageBitmap` decode → placeholders → XHR upload → ready) is the
  real one, byte for byte.
- **TC-25 delays the upload responses ~2.5 s** (route → `route.fetch()` →
  timed `route.fulfill`) so the uploading states are observable on both
  screens; the drop-to-visible time on Sam is logged against
  `LIVE_UPDATE_LATENCY_BUDGET_MS` (reported, not asserted — shared
  machine).
- **Component tests TC-17/18/29 mock `uploadImage`** (progress emission,
  resolution, rejection); the jsdom `createImageBitmap` stub supplies the
  dimensions. The window paste listener's editable-target guard is tested
  with a real focused `<textarea>` (TC-18).
- **`ObjectSnapshot` already types the image fields** (`assetKey`,
  `contentType`, `naturalWidth/Height`, `status`, `uploadStartedAt`,
  `uploaderId`) added in task 5, so `BoardPage`'s wiring is cast-free.
- **`useImageInsert` keeps the accepted `File` per object id in memory**
  (Retry re-sends the same bytes) and aborts every in-flight XHR on
  unmount; toasts dedupe identical messages and auto-dismiss after
  `TOAST_VISIBLE_MS`.
