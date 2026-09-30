# Notes

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions

- **BoardViewport integration**: Added `onEmptyDoubleClick` and `onEmptyClick` callbacks to `BoardViewport` to avoid circular dependencies. The viewport detects clicks/drags on its own element (empty space) and invokes these callbacks. The `App.tsx` wires them to create notes and clear selection.

- **NoteLayer component**: Introduced an intermediate `NoteLayer` component rendered inside the `BoardViewport` children to access the camera zoom from `useBoard()` context and pass it down to each `StickyNote`. This satisfies the design's `zoom` prop requirement while working within the component tree.

- **Text editor outside-click detection**: The `StickyTextEditor` calls `onEnd('unselected')` via the App-level click handler on the viewport. The `BoardViewport`'s `onEmptyClick` fires when a pointerup occurs without movement on the viewport element itself (since the note's `pointerdown` calls `stopPropagation`, clicks on notes don't trigger the viewport's empty-click detection).

- **NoteToolbar screen-space positioning**: The `NoteToolbar` is rendered in the overlay (fixed-position) layer, using `worldToScreen` to position it above the selected note. This keeps it unscaled by zoom as the design requires.

- **Font auto-fit**: `fitFontSize` is implemented for use in real browser contexts. In the component (jsdom) tests, a simplified heuristic is used since jsdom doesn't perform real text layout. The e2e test verifies the actual computed font sizes.

- **`yjs` dependency**: Added as a regular dependency (not dev) since it's part of the production application logic.

- **E2E test tolerance**: Used ±2px tolerance for drag tests at different zoom levels to account for floating-point rounding in the world-coordinate calculation during rapid pointer events.

### What was built

- `src/shared/board-model.ts` — Yjs schema, all mutations (createSticky, moveObject, bringToFront, setStickyColor, deleteObject, getStickyText, snapshot)
- `src/client/board/useBoardDoc.ts` — Y.Doc lifecycle hook with `useSyncExternalStore`
- `src/client/board/useSelection.ts` — local selection/editing state
- `src/client/board/Toolbar.tsx` — left toolbar with "Sticky note" button
- `src/client/objects/StickyNote.tsx` — render, select, drag-to-move, double-click-to-edit
- `src/client/objects/NoteLayer.tsx` — renders all notes, passes zoom from context
- `src/client/objects/NoteToolbar.tsx` — 6 colour swatches + delete button
- `src/client/objects/StickyText.ts` — clampToLimit, applyTextDiff, counterVisible, fitFontSize
- `src/client/objects/StickyTextEditor.tsx` — textarea with Y.Text binding, length clamping, Escape handling
- Modified `src/client/canvas/BoardViewport.tsx` — added dblclick and empty-click detection
- Modified `src/client/App.tsx` — wired doc, selection, toolbars, keyboard handlers

## Story 3: See other people's edits appear live on the same board

### Decisions

- **y-websocket wire format**: The y-websocket protocol does NOT wrap sync content in `varUint8Array`. It writes `varUint(MESSAGE_SYNC=0)` followed directly by sync protocol bytes. Awareness messages DO use `varUint8Array` wrapping: `varUint(MESSAGE_AWARENESS=1) + varUint8Array(payload)`. This was discovered after initial implementation failed to sync.

- **Downgraded `@cloudflare/vitest-pool-workers`**: From 0.22.x to 0.12.x due to peer dependency conflict with vitest 3 (0.22 requires vitest 4). Version 0.12 works correctly with our vitest 3.2 setup.

- **`isolatedStorage: false`**: Durable Object storage isolation causes cleanup errors ("Expected .sqlite, got .sqlite-shm") during test teardown when WebSockets are open. Disabling isolation avoids this race condition; tests still verify functional behavior correctly.

- **Test env DO binding name**: `vitest-pool-workers` v0.12 normalizes Durable Object binding names to SCREAMING_SNAKE_CASE in the test `env` export (e.g., `BOARD_ROOM`). The actual worker handler receives the name as configured in `wrangler.jsonc`.

- **Durable Object `WebSocketPair` pattern**: Uses `new WebSocketPair()` + `server.accept()` + returns `{ status: 101, webSocket: client }` which is the correct pattern for accepting WebSocket connections in Cloudflare Workers.

- **Client connection URL**: `connectBoard` constructs `ws(s)://${location.host}/api/rooms` as the base URL, and `WebsocketProvider` appends `/${roomname}` to form the full path `/api/rooms/${boardId}`.

- **Initial connect vs reconnection state**: The initial sync goes `connecting → connected` (no "Connected" badge flash). Only reconnections show `reconnecting → confirmed → connected` with the debounce timer.

- **Board routing**: `getBoardIdFromPath()` reads `/b/:boardId` from `location.pathname`; if missing, generates a new ID and uses `history.replaceState`.

- **Soft capacity limit**: MAX_CONCURRENT_EDITORS is a reporting metric only; the Durable Object never refuses connections regardless of count (TC-13 verifies this).

### What was built

- `src/shared/board-id.ts` — `isValidBoardId`, `newBoardId` (16 random bytes → base64url no padding)
- `src/shared/protocol.ts` — y-websocket message constants and `decodeMessage`
- `src/worker/index.ts` — Worker entry: routes `/api/rooms/:boardId` to BoardRoom DO, validates board IDs, 426 for missing Upgrade
- `src/worker/board-room.ts` — Durable Object with Y.Doc, WebSocket sync relay, awareness relay, malformed message handling
- `src/client/sync/connectBoard.ts` — `connectBoard()` managing WebsocketProvider lifecycle with state machine
- `src/client/sync/ConnectionStatus.tsx` — Badge showing connecting/reconnecting/confirmed states
- Modified `src/client/board/useBoardDoc.ts` — accepts boardId, attaches/detaches provider
- Modified `src/client/board/useSelection.ts` — clears selection when notes are deleted remotely
- Modified `src/client/App.tsx` — reads boardId from URL, shows ConnectionStatus
- Modified `wrangler.jsonc` — DO binding, migration, assets binding
- `tests/integration/` — Worker routing and BoardRoom integration tests (24 tests)
- `tests/component/ConnectionStatus.test.tsx` — Status badge component tests
- `tests/e2e/collaboration.spec.ts` — Multi-browser collaboration e2e tests
- `tests/e2e/collaboration-nightly.spec.ts` — Nightly soak and idle stability tests
- `tests/e2e/helpers/participants.ts` — E2E helpers for multi-participant tests

## Story 5: Share a board with others using a link

### Decisions

- **Boards are created server-side; `/` no longer auto-redirects.** Story 3 used a
  client-side `getBoardIdFromPath()` that minted a random id and `history.replaceState`d
  to it on any visit. Story 5 replaces that: a board exists only after `POST /api/boards`.
  Opening a link whose board does not exist is a real `not_found`, not an implicit create.

- **`BoardStore` no longer creates tables on read.** Previously `attemptLoad()` called
  `migrate()` on every WebSocket connect, which created storage tables as a *side effect
  of a GET/upgrade* — that would make an unknown board "exist". Now `load()` checks
  `hasTables()` and, when absent, returns an empty-but-OK result without writing anything.
  `migrate()` only runs through `initialize()` (creation) or lazily inside `append()`
  (the first real write). `tablesReady` tracks the instance state so the lazy path stays
  cheap. This is what makes TC-06/TC-09 ("probe leaves no storage") observable.

- **Two Durable Object RPCs added.** `initialize(): 'created' | 'exists'` (create path:
  migrate + stamp `created_at` if absent) and `exists(): boolean` (existence check). The
  Worker's `fetch()` for `/api/rooms/:id` now calls `existsReadOnly()` first and returns
  404 for an unknown board, so a WebSocket upgrade to a never-created id is refused with
  404 and never opens a socket (TC-09).

- **`existsReadOnly()` treats legacy boards as existing.** Boards that pre-date story 5
  (story 3/4 seeded rows via the test hooks without a `created_at`) are considered to
  exist when they have any `updates` rows even with no `created_at` marker. This keeps
  story 4's broken-board and large-board-persistence e2e scenarios (which seed data
  directly) opening normally — no data is re-initialised or overwritten.

- **`nextBoardPageState` takes a 4th `boardId` argument.** The design signature
  `(state, result, attempt)` cannot produce the `ready` state's `{ boardId }`, so the
  id is threaded through as a 4th parameter and echoed into `{ kind: 'ready', boardId }`.
  Retry delay is `BOARD_CHECK_RETRY_BASE_MS * 2^(attempt-1)` (first retry is exactly the
  base) capped at `RECONNECT_MAX_BACKOFF_MS`.

- **`App` split into router host + `Board` component.** `App.tsx` exports `App` (a thin
  `useRoute()` switch to HomePage/BoardPage/NotFoundPage) and `Board` (the stories 1–4
  board UI, now taking a `boardId` prop). `BoardPage` renders `Board` + `SharePanel` once
  the board is `ready`. `SharePanel` lives at `src/client/share/SharePanel.tsx`, owned by
  `BoardPage` (matching the design's BoardPage→Board / BoardPage→Share diagram). The
  circular `App ↔ BoardPage` import is safe: `Board` is a hoisted function declaration and
  is only referenced inside component bodies.

- **Minimal History-API router.** `src/client/router.ts` uses `useSyncExternalStore` over
  `location.pathname`, re-rendering on `popstate`; `navigate()` pushes state and dispatches
  a `PopStateEvent` so the hook updates. Routes: `/` → home, `/b/:id` → board, else
  → not_found (a malformed id inside `/b/:id` is resolved by `BoardPage` via
  `isValidBoardId`, so it never issues a request — TC-23).

- **Clipboard fallback.** `SharePanel` copy uses `navigator.clipboard.writeText`. When
  `clipboard` is missing or the promise rejects, it marks the field with the manual-copy
  message and calls `input.select()` so the whole link is highlighted for Ctrl+C. The
  Share button is always mounted (the panel is conditionally rendered alongside it) so
  Escape/outside-close can return focus to it.

- **No-referrer.** `index.html` adds `<meta name="referrer" content="no-referrer" />` so
  the board id in a shared URL is not leaked to third parties (asserted in TC-32, served
  document).

- **E2E board creation.** `gotoBoard()` and a new `createBoardViaUi()` helper create a
  board through the Home "New board" button (the old story-3 implicit redirect is gone).
  `collaboration`, `collaboration-nightly`, and `persistence` now create a board first,
  then join the same link. Multi-client e2e tests use `createParticipant` for *joining*
  an existing board (it no longer creates one).

- **TC-12 via a fake `Env`.** A 500 `create_failed` is exercised by handing `createBoard`
  (and the Worker `fetch` directly) a fake `Env` whose `BOARD_ROOM.get()` stub throws on
  `initialize()`. Injecting an RPC fault through the live `SELF`/Durable Object isn't
  possible, so the failure is injected at the stub boundary; the routing/mapping under
  test is the real Worker code.

- **Test-only adaptation (not weakened).** `tests/component/LoadFailed.test.tsx` renders
  the extracted `Board` component (imported from `App`) instead of `App`, because `App` is
  now the router. Assertions are unchanged. `tests/integration/worker.test.ts` TC-04 now
  expects 404 (not 400) for an invalid board id, matching the story-5 "unknown board →
  not found" model; integration `ws-client.createSyncClient` calls the `initialize` RPC
  before connecting so story 3/4 sync tests keep their intent.

- **Pre-existing flaky tests observed (unrelated to story 5 logic).** Two tests are
  intrinsically timing/random sensitive and occasionally fail only when the whole suite
  runs at high parallelism, but pass reliably in isolation and on re-run:
  integration `board-room-persistence` TC-15 (corrupts the snapshot with `Math.random()`
  bytes — damage strength varies) and e2e `collaboration` TC-23 (concurrent CRDT typing
  under 16 Playwright workers). Neither touches the story-5 code paths; they were left
  unchanged rather than weakened.

### What was built

- `src/shared/config.ts` — added `CREATE_BUDGET_MS`, `LINK_COPIED_MS`, `BOARD_CHECK_RETRY_BASE_MS`
- `index.html` — added the `no-referrer` meta tag
- `src/worker/board-store.ts` — `existsReadOnly()`, `setCreatedAtIfAbsent()`, `getCreatedAt()`,
  `hasTables()`; read path no longer creates tables; lazy migrate on first write
- `src/worker/board-room.ts` — `initialize()` / `exists()` RPCs; 404 for unknown boards on
  WebSocket/`fetch`; removed the read-time `migrate()`
- `src/worker/create-board.ts` — `createBoard(env): { ok, id } | { ok:false, reason }`
- `src/worker/index.ts` — `POST /api/boards` (201 / 500 / 405), `GET /api/boards/:id`
  (200 / 404); invalid `/api/rooms/:id` id now 404
- `src/client/api.ts` — `createBoardRequest()`, `checkBoard()` with typed responses
- `src/client/router.ts` — `useRoute()`, `navigate()`, `parseRoute()`
- `src/client/pages/state.ts` — `HomePageState`, `BoardPageState`, `nextBoardPageState()`
- `src/client/pages/useCreateBoard.ts` — shared "New board" create action
- `src/client/pages/HomePage.tsx` — vidi6 hero + New board button (Creating…/error states)
- `src/client/pages/NotFoundPage.tsx` — Board not found + New board + back-home link
- `src/client/pages/BoardPage.tsx` — existence check, "Opening board…", retry with
  exponential backoff, not-found, ready (Board + SharePanel)
- `src/client/share/SharePanel.tsx` — Share button, panel, copy-to-clipboard, manual-copy
  fallback, Escape/outside close with focus restore
- `src/client/App.tsx` — now exports `App` (router) and `Board` (board UI); removed the
  implicit-redirect board-id minting
- `src/client/styles.css` — Home / not-found / loading / share styles
- `tests/unit/create-board.test.ts` — TC-04 (link-code strength/uniqueness)
- `tests/integration/board-api.test.ts` — TC-05–TC-10, TC-12, TC-14, TC-15, TC-32
- `tests/component/{HomePage,BoardPage,SharePanel}.test.tsx` — TC-16, TC-17, TC-19–TC-25
- `tests/e2e/share.spec.ts` — TC-26, TC-27, TC-28, TC-29, TC-31
- Modified e2e helpers (`board.gotoBoard`, `participants.createBoardViaUi`) and the
  existing collaboration / navigation / sticky-notes / persistence specs to create boards
  explicitly

## Story 7: Select, move, resize and delete several objects at once

### Decisions

- **Camera ref pattern**: The `BoardViewport` component owns the camera state, but `useTransformGesture` and `useMarquee` are called in the parent `Board` component (above the context provider). Passing the camera via React context is impossible because the context is provided *below* where the hooks are called. Solution: a `MutableRefObject<Camera>` prop on `BoardViewport` that's updated on every render, read at event-handler time inside gesture/marquee closures. This avoids stale-closure bugs at non-1.0 zoom levels.

- **Group move delta computation**: Uses the raw screen-pixel delta divided by `cameraRef.current.zoom` rather than `screenToWorld` for the drag delta. This is simpler, avoids jitter from rounding in world-coordinate conversions, and exactly matches the spec’s “screen delta / zoom = world delta” requirement.

- **`startEdit` replaces selection**: The `edit` action in the selection reducer now also sets `ids = new Set([id])`, matching the behavior of other design tools (double-clicking a note selects it exclusively and enters editing). `endEdit()` only clears `editingId`, leaving the note selected so the toolbar appears.

- **Escape double-handling fix**: React 18 flushes discrete-event (keydown) state updates synchronously. After `StickyTextEditor` handles Escape and dispatches `endEdit()`, the textarea unmounts before the native event bubbles to the `window` listener in `useBoardKeys`, making `isEditingText()` return false. Fix: `StickyTextEditor` sets a transient `window.__vidi6_escapeHandled` flag; `useBoardKeys` checks and clears it, preventing the second Escape handler from clearing selection.

- **`useSelection` prune optimization**: Uses a stringified key (sorted ids joined) to detect when the set of present objects actually changes, avoiding re-renders when `snapshot(doc)` produces a new array with same ids on each render.

- **`useTransformGesture` handles unselected notes**: When a drag starts on a note not yet in `selection.ids`, the gesture captures `draggedId` and adds it to the set used for `startRects`. This fixes the race where `selection.click(id)` dispatches a state update that hasn't been applied when the drag threshold is crossed.

- **Object type registry**: `src/client/objects/registry.tsx` provides a type-keyed map of object capabilities (resizable, aspectLocked, minSize, editableText, etc). Story 7 registers the `sticky` type. Future object types add entries here without changing the gesture or selection logic.

- **Geometry module**: `src/shared/geometry.ts` contains pure rect/resize math (`resizeRect`, `clampScale`, `scaleWithin`, `unionRects`) shared by the resize gesture and unit-tested independently.

- **`data-object-id` attribute**: Added to `StickyNote` DOM element to enable e2e tests to identify notes by their Yjs id (stable across z-order re-sorting) rather than relying on DOM order.

### What was built

- `src/shared/geometry.ts` — Rect, Point, Handle types; rectContains, unionRects, normalizeRect, resizeRect, clampScale, scaleWithin
- `src/client/objects/registry.tsx` — ObjectTypeSpec interface, registerObjectType, getObjectType, sticky type registration
- `src/client/board/useSelection.ts` — Rewritten as a reducer: click, toggle, setMany, clear, prune, edit actions; SelectionApi interface
- `src/client/board/useTransformGesture.ts` — Group move and handle resize; cameraRef, draggedId, async state handling
- `src/client/board/Marquee.tsx` — useMarquee hook (shift+drag), MarqueeRect component
- `src/client/board/SelectionOverlay.tsx` — Per-object outlines + bounding box + 8 resize handles
- `src/client/board/SelectionBar.tsx` — “N selected” + Delete for 2+; returns null for single sticky
- `src/client/board/useBoardKeys.ts` — Ctrl+A, Escape, arrows (nudge), Delete/Backspace; escapeHandled flag
- `tests/unit/geometry.test.ts` — 14 tests for rect math
- `tests/unit/board-model-group.test.ts` — 14 tests for batch model ops (moveObjects, resizeObjects, deleteObjects, objectsInRect, bringObjectsToFront)
- `tests/unit/selection-reducer.test.ts` — 10 tests for selection reducer
- `tests/unit/registry.test.ts` — 5 tests for object type registry
- `tests/component/Story7.test.tsx` — 18 tests (TC-16–TC-31)
- `tests/e2e/select-move-resize.spec.ts` — 5 tests (TC-32–TC-36)
- Modified `src/shared/config.ts` — HANDLE_SIZE_PX, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD
- Modified `src/shared/board-model.ts` — objectBounds, objectsInRect, allObjectIds, moveObjects, resizeObjects, bringObjectsToFront, deleteObjects
- Modified `src/client/objects/StickyNote.tsx` — Delegates drag to onObjectPointerDown; shift-click toggle; data-object-id
- Modified `src/client/objects/NoteLayer.tsx` — Passes SelectionApi
- Modified `src/client/canvas/BoardViewport.tsx` — cameraRef prop, marquee callbacks
- Modified `src/client/App.tsx` — Wires all new hooks/components together
- Modified `src/client/objects/StickyTextEditor.tsx` — escapeHandled flag
