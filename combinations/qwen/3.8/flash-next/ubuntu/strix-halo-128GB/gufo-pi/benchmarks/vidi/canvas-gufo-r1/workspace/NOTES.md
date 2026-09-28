# Implementation Notes

## Story 8: Undo and redo my own changes without undoing anyone else's

### Key Decisions

1. **Origin filtering via `trackedOrigins`**: The `Y.UndoManager` is configured with `trackedOrigins: new Set([LOCAL_ORIGIN])`. Only transactions made by this tab (using the `LOCAL_ORIGIN` symbol from `board-model`) enter the undo/redo stacks. Remote changes (from the WebSocket provider) and load-origin updates are never captured.

2. **One controller per board doc**: Created in `BoardApp.tsx` via `useMemo(() => createUndo(doc), [doc])`, destroyed on unmount. History is session-only (does not survive reload or board change).

3. **Boundary = `stopCapturing()`**: The `boundary()` method calls `UndoManager.stopCapturing()`, which sets `lastChange = 0`, preventing the next transaction from merging with the current stack item. Called at gesture start/end, edit start/end, and around group operations (delete, colour, create) to ensure each user action is exactly one undo step.

4. **Typing bursts merge naturally**: Yjs uses `Date.now()` for capture timing. Synchronous transactions (same tick) always merge because `now - lastChange = 0 < captureTimeout`. Typing within an editor merges into one step; `boundary()` at edit start/end prevents merging with neighbouring actions.

5. **Yjs `popStackItem` behavior**: When undoing a move of a remotely-deleted object, Yjs's internal `while` loop in `popStackItem` transparently skips the no-op and applies the next effective step. This matches the PRD requirement: "nothing visible happens, no error; the next undo continues normally."

6. **Capture timeout testing**: Yjs captures `Date.now` at module load time (`export const getUnixTime = Date.now`), so `vi.useFakeTimers()` cannot intercept it. Tests use same-tick merging (which naturally exercises the captureTimeout path) and explicit `boundary()` calls to test separation.

7. **Stack trimming**: On `stack-item-added`, the controller trims `undoStack` from the front while `length > maxSteps` (default 200).

8. **Undo shortcuts in `useBoardKeys`**: Ctrl/Cmd+Z → undo; Ctrl/Cmd+Shift+Z and Ctrl+Y → redo. All with `preventDefault`. Guarded by: not while editing in a sticky (the editor handles it), not when focus is in a non-board input/textarea, and not when `canEdit` is false.

9. **StickyTextEditor intercepts undo**: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z inside the textarea call the controller (with `preventDefault` and `stopPropagation`) so native textarea undo never diverges from Y.Text. Boundary is called on mount (edit start) and on Escape (edit end).

### Files Added/Modified

| File | Change |
|---|---|
| `src/shared/config.ts` | Added `UNDO_CAPTURE_TIMEOUT_MS` (500) and `UNDO_MAX_STEPS` (200) |
| `src/client/board/undo.ts` | New: `createUndo()` → `UndoController` |
| `src/client/board/useUndo.ts` | New: React binding `useUndo()` |
| `src/client/board/UndoButtons.tsx` | New: toolbar buttons with `aria-label="Undo"/"Redo"` |
| `src/client/board/Toolbar.tsx` | Modified: renders `UndoButtons` |
| `src/client/board/useBoardKeys.ts` | Modified: undo/redo keyboard shortcuts |
| `src/client/board/useTransformGesture.ts` | Modified: calls `onGestureStart`/`onGestureEnd` (wired to boundary) |
| `src/client/objects/StickyTextEditor.tsx` | Modified: boundary + undo/redo interception |
| `src/client/objects/StickyNote.tsx` | Modified: passes `undoController` to editor |
| `src/client/BoardApp.tsx` | Modified: creates controller, wires boundaries |
| `src/client/canvas/testHooks.ts` | Modified: exposes `undoManager` and `LOCAL_ORIGIN` for e2e |
| `tests/unit/undo-history.test.ts` | New: TC-01 to TC-11 |
| `tests/unit/undo-boundaries.test.ts` | New: TC-12, TC-13 |
| `tests/unit/undo-peer.ts` | New: simulated peer helper |
| `tests/component/UndoBoundaries.test.tsx` | New: TC-14 to TC-17 |
| `tests/component/UndoControls.test.tsx` | New: TC-18 to TC-21 |
| `tests/e2e/undo.spec.ts` | New: TC-22 to TC-24 |

## Story 5: Share a board with others using a link

### Key Decisions

1. **Board creation is server-side**: `POST /api/boards` → rate-limited → `createWithRetries(newBoardId, stub.initialize())`. The rate limiter is configured in `wrangler.jsonc` as a native Cloudflare Workers `ratelimits` binding (10 per 60 seconds, keyed by `CF-Connecting-IP`).

2. **`BoardRoom.initialize()` RPC**: Creates SQLite tables via `store.migrate()`, then checks/inserts `created_at` in `storage_meta`. Returns `'created'` on first call, `'exists'` on subsequent calls. This is idempotent.

3. **`BoardRoom.exists()` RPC**: Calls `store.existsReadOnly()` which is a pure read — no writes. Checks: tables exist → `created_at` row → legacy rows in `updates`/`snapshot_chunks`.

4. **Lazy loading**: `BoardRoom` no longer auto-loads in `constructor()`. Instead, `loaded` flag gates lazy `loadFromStorage()` in `fetch()`. This avoids creating tables for boards that are never initialized.

5. **`fetch()` checks existence**: Before accepting WebSocket upgrade, `BoardRoom.fetch()` calls `existsReadOnly()`. Returns 404 for boards that don't exist. This prevents WebSocket connections to non-existent boards.

6. **`BoardStore.load()` handles missing tables**: If `storage_meta` table doesn't exist in `sqlite_master`, returns `{ok: true, quarantined: 0}` without creating anything. This supports the lazy-load pattern.

7. **`BoardStore.append()` does lazy migrate**: If not yet migrated in this session, calls `migrate()` before inserting. This supports boards that receive updates before `initialize()`.

8. **Malformed board IDs → 404** (was 400 in story 3): Both `/api/boards/:id` and `/api/rooms/:id` return 404 for invalid IDs.

9. **Client router**: History API-based, no library. Routes: `/` → Home, `/b/:id` → Board, anything else → NotFound. `useRoute()` hook listens to `popstate`.

10. **Board page existence check**: `GET /api/boards/:id` on mount. States: `checking` (shows "Opening board…"), `not_found` (renders NotFoundPage), `unreachable` (shows "Couldn't reach vidi6. Retrying…" with exponential backoff capped at `RECONNECT_MAX_BACKOFF_MS`).

11. **Share panel**: Opens on "Share" button click. Shows link input (read-only), "Copy link" button, note text. Clipboard API with fallback to manual copy (`select()` + "Press Ctrl+C" message). "✓ Link copied" shown for `LINK_COPIED_MS` (2000ms). Closes on Escape key or outside pointerdown.

12. **`<meta name="referrer" content="no-referrer">`**: Added to `index.html` to prevent board IDs leaking via referrer headers.

13. **`BoardApp` extracted from `App`**: The board UI (canvas, toolbars, notes) was extracted into `BoardApp.tsx` so `App.tsx` can be a thin router wrapper. Component tests (Toolbars) use `BoardApp` directly.

### Gaps in Prior Stories

- **Story 3 (real-time collaboration)**: Previously used `newBoardId()` on the client side to create rooms implicitly via WebSocket connection. Story 5 requires boards to be explicitly created first. Integration tests were updated to use `runInDurableObject` + `initialize()` instead of relying on implicit board creation through WebSocket.
- **E2E tests**: Updated `gotoBoard()` and `makeBoardId()` helpers to create boards via `POST /api/boards` API before navigating.
- **Test hooks**: Added `POST /__test/boards/:id/seed-legacy` hook to seed a legacy board (tables + update rows, no `created_at`) for testing story 5's existence check against pre-story-5 boards.

### Rate Limiter in Tests

- Integration tests use unique `CF-Connecting-IP` headers per test to avoid mutual rate-limit interference.
- TC-13 specifically tests the limit boundary (10 from same IP → 201, 11th → 429).

## Story 7: Select, move, resize and delete several objects at once

### Key Decisions

1. **Selection is a reducer**: `useSelection` uses `useReducer` with `SelectionState = { ids: ReadonlySet<string>, editingId: string|null }` and actions: `click`, `toggle`, `setMany`, `clear`, `prune`, `edit`. The reducer is exported for unit testing.

2. **Group model functions**: `moveObjects`, `resizeObjects`, `bringObjectsToFront`, `deleteObjects` operate on arrays of ids. Existing single-object functions (`moveObject`, `bringToFront`, `deleteObject`) are thin wrappers.

3. **Geometry helpers**: `src/shared/geometry.ts` provides `Rect`, `Point`, `Handle` types and pure functions (`rectContains`, `unionRects`, `normalizeRect`, `resizeRect`, `clampScale`, `scaleWithin`).

4. **Object type registry**: `src/client/objects/registry.tsx` defines `ObjectTypeSpec` with `resizable`, `aspectLocked`, `minSize`, `editableText`, `hitTest`. Only `sticky` is registered so far.

5. **Transform gesture**: `useTransformGesture` handles group move (drag any selected object → all move) and handle resize (bounding-box proportional scaling with `scaleWithin`). RAF-coalesced writes. `onGestureStart`/`onGestureEnd` hooks for suppressing edit UI.

6. **Marquee selection**: Shift+pointerdown on empty board starts marquee. Only fully-contained objects are added to the selection. Plain drag (no Shift) pans camera. `useMarquee` hook + `MarqueeRect` component.

7. **Keyboard commands**: `useBoardKeys` handles Ctrl/Cmd+A (select all), Escape (clear), arrows (nudge 1/10 world units), Delete/Backspace (delete selection). Guards on `editingId` and input focus.

8. **Resize is aspect-locked for stickies**: `scaleWithin` maps child rects proportionally from source bbox to target bbox. `clampScale` prevents below `STICKY_MIN_SIZE_WORLD` or above `MAX_OBJECT_SIZE_WORLD`.

9. **Selection auto-prunes**: When the snapshot changes, remote-deleted ids are automatically removed from the selection set (prune action in reducer).

10. **`useBoardDoc` uses `useState` instead of `useSyncExternalStore`**: `useSyncExternalStore` with React 19 had an issue where text-only Y.Doc updates fired `observeDeep` but did not trigger re-renders. Switched to `useState` + `useEffect` observer pattern.

### Gaps in Prior Stories

- **Story 3/5 (e2e tests)**: Wrangler v3 doesn't support `ratelimits` binding locally. Added an in-memory `MemoryLimiter` fallback in `src/worker/index.ts` and a `POST /api/test/reset-rate-limit` endpoint for tests.
- **Story 5 (`.dev.vars`)**: Created `.dev.vars` file with `TEST_HOOKS=1` since wrangler doesn't pass shell env vars to worker code.
- **Story 5 (`run_worker_first`)**: Added `run_worker_first: true` to `wrangler.jsonc` assets config so the worker handles `/api/*` and `/__test/*` paths before the static asset middleware (which returns 405 for POST to non-existent paths).
- **Story 5 (`testHooks.ts`)**: Fixed `installDocHooks` to create `window.__vidi6` if it doesn't exist (was previously silently failing when `installDocHooks` ran before `installTestHooks`).
- **Story 2 (`StickyNote`)**: Sticky note pointer events now delegate to `onObjectPointerDown` prop for the transform gesture, instead of internal drag logic.
- **Share-board TC-26**: Updated test to use `create-sticky-btn` (was `add-sticky-btn`) and `toPass()` retry block to handle textarea value vs textContent for edit-mode sync.

## Story 10: Draw shapes and connect them with arrows that follow when moved

### Key Decisions

1. **Shape model (`src/shared/objects/shape.ts`)**: `createShape(doc, { kind, rect | null, at }, by)` creates a shape with validation. `rect=null` uses default size centred on `at`. Below `SHAPE_MIN_SIZE_WORLD` falls back to default. Shift+drag creates square (uses larger dimension). Supports `rect`, `ellipse`, `diamond` kinds.

2. **Connector model (`src/shared/objects/connector.ts`)**: `createConnector(doc, from, to, by)` validates finiteness, rejects self-loops, and checks minimum length (`CONNECTOR_MIN_LENGTH_WORLD`). Endpoints are `{ kind: 'attached', objectId, fallback: Point }` or `{ kind: 'free', x, y }`. The `fallback` is the anchor position at creation time.

3. **Endpoint resolution (`src/shared/geometry/connector-geometry.ts`)**: `resolveEndpoints(from, to, rects)` computes world-space line endpoints dynamically. For attached endpoints, it determines the anchor side using `nearestSide(rect, otherPoint)` — the arrow always connects to the side closest to the other end. `connectorBBox(from, to)` computes the bounding box for hit testing.

4. **`detachConnectorsTo` in `deleteObjects`**: When objects are deleted, any connector endpoints pointing at deleted IDs are converted from `attached` to `free` endpoints at their current anchor position. This is done inline within `deleteObjects` (not in connector.ts) to avoid circular imports.

5. **Connector snapshot derives x/y/width/height from resolved endpoints**: In `board-model.ts`'s `snapshot()`, connectors go through a second pass after all other objects are collected. The rects map is built first, then each connector's bbox is computed via `resolveEndpoints` + `connectorBBox`.

6. **Tool state: two-layer design**: `useTool` (existing) handles `select | text` (via `useBoardKeys`). `useActiveTool` (new) handles `select | shape | connector` keyboard shortcuts (S, L, V, Escape). Shape/connector overlays are suppressed when the other's tool state is active. Text tool click behavior is gated by `toolState.tool === 'text' && activeToolState.tool === 'select'`.

7. **Overlays rendered outside `<BoardViewport>`**: The `.board-world` has CSS `transform` + `width:0; height:0`. Fixed-position overlays inside it would be positioned relative to the transform, not viewport. Shape and connector tool overlays are rendered as siblings to `<BoardViewport>` with `position: fixed`.

8. **ConnectorObject renders as SVG line + polygon arrowhead**: The line coordinates are derived from `resolveEndpoints` on each render. Selection shows two circular handles for re-attach. Re-attach uses `window.pointermove/pointerup` listeners during drag.

9. **ShapeObject renders as SVG shapes (rect/ellipse/polygon) with centered label**: The `foreignObject` + `contentEditable` pattern is used for inline label editing (same as sticky notes). Labels are clamped to `SHAPE_LABEL_MAX_CHARS` (500).

10. **Shape toolbar with fill/stroke swatches**: `ShapeToolbar` renders color swatches from `SHAPE_FILL_COLORS` and `SHAPE_STROKE_COLORS` (5 colors each). Clicking a swatch calls `setShapeStyle()` which validates the color key before writing.

11. **PointerEvent polyfill in test setup**: jsdom lacks `PointerEvent` and `setPointerCapture`. Added a polyfill class and no-op capture methods to `tests/component/setup.ts`.

12. **`text-tool-btn` uses `tool` state not `activeTool`**: Existing ToolMode tests expect text button pressed state from `toolState.tool === 'text'`. Toolbar renders `aria-pressed={tool === 'text'}` for text button, `aria-pressed={activeTool === 'shape'}` for shape button.

### Files Added/Modified

| File | Change |
|---|---|
| `src/shared/geometry/connector-geometry.ts` | New: `sideAnchor`, `nearestSide`, `resolveEndpoints`, `connectorBBox`, `Endpoint` types |
| `src/shared/geometry/polyline.ts` | New: `distanceToPolyline` helper |
| `src/shared/objects/shape.ts` | New: `createShape`, `setShapeStyle`, `getShapeLabel` |
| `src/shared/objects/connector.ts` | New: `createConnector`, `setConnectorEndpoint`, `detachConnectorsTo`, `getConnectorSnapshot` |
| `src/shared/config.ts` | Modified: added shape/connector constants (SHAPE_KINDS, SHAPE_DEFAULT_SIZE_WORLD, etc.) |
| `src/shared/board-model.ts` | Modified: added ShapeObjectSnapshot, ConnectorObjectSnapshot to union; connector detach in deleteObjects |
| `src/shared/geometry/index.ts` | Renamed from geometry.ts; re-exports |
| `src/client/tools/useActiveTool.ts` | New: ToolId type, keyboard shortcuts, toolCreated |
| `src/client/tools/ShapeTool.tsx` | New: drag-to-create overlay |
| `src/client/tools/ConnectorTool.tsx` | New: drag-from-shape-to-shape overlay |
| `src/client/objects/ShapeObject.tsx` | New: SVG shape rendering + label editing |
| `src/client/objects/ConnectorObject.tsx` | New: SVG line + arrowhead + re-attach handles |
| `src/client/objects/ShapeToolbar.tsx` | New: fill/stroke color swatches |
| `src/client/objects/registry.tsx` | Modified: register shape and connector types |
| `src/client/board/Toolbar.tsx` | Modified: Shape and Connector buttons, shape kind submenu |
| `src/client/BoardApp.tsx` | Modified: integrated ShapeTool, ConnectorTool, ShapeObject, ConnectorObject |
| `tests/component/setup.ts` | Modified: PointerEvent polyfill |
| `tests/unit/shape-model.test.ts` | New: TC-01 to TC-06 |
| `tests/unit/connector-model.test.ts` | New: TC-07 to TC-14, TC-29 |
| `tests/component/ShapeTool.test.tsx` | New: TC-15 to TC-17, TC-28 |
| `tests/component/ConnectorTool.test.tsx` | New: TC-18 to TC-22 |
| `tests/e2e/shapes-connectors.spec.ts` | New: TC-23 to TC-27 |
