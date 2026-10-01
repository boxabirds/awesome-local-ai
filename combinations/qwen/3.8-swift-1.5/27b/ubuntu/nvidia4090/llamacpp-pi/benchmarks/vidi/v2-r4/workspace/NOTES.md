# Story 7: Design Decisions

## Selection Model
- Selection is **per-client (local)**, not synced over the wire. Each editor has their own selection state.
- `useSelection` hook manages a `Set<string>` of selected object IDs plus an optional `editingId`.
- Selection state is managed via a reducer (`selectionReducer`) for testability.

## Marquee Selection
- Shift+drag on empty space creates a marquee rectangle.
- Only objects **fully inside** the marquee rect are selected (using `objectsInRect` from `geometry.ts`).
- The marquee uses **non-additive** `setMany` to replace the current selection. This avoids interaction issues with the edit state (when a note is created via double-click, it enters edit mode which also sets the selection).
- `handleMarqueeBegin` calls `selection.clear()` before starting the marquee to ensure a clean state.

## Group Transform
- `useTransformGesture` handles move and resize of multi-selection.
- **Move**: delta is applied to all selected objects' positions.
- **Resize**: the bounding box of all selected objects is computed, and a resize handle on the bounding box scales all objects proportionally using `scaleWithin` from `geometry.ts`.
- Aspect lock: when resizing the group bounding box, `resizeRect` with aspect lock uses `Math.max(scaleX, scaleY)` when growing and `Math.min` when shrinking.

## Object Registry
- `registry.tsx` provides a type-safe registry of object types (currently just `sticky`).
- `setRegisteredTypes()` is called at module level in `BoardUI.tsx` to register all object types.
- Each type provides a `render` function that receives `ObjectProps` (obj, doc, zoom, selected, editing, editable, onPointerDown, onStartEdit, onEndEdit).

## Geometry Utilities
- `geometry.ts` (shared) provides pure functions: `normalizeRect`, `rectsIntersect`, `rectContainsLocal`, `objectsInRect`, `objectBounds`, `resizeRect`, `clampScale`, `scaleWithin`, `boundingBox`.
- These are framework-agnostic and fully unit-tested.

## Board Model Group Operations
- `applyGroupMove(doc, ids, delta)` — moves all objects in `ids` by `delta`.
- `applyGroupScale(doc, ids, from, to)` — scales all objects from `from` bounding box to `to` bounding box.
- `deleteObjects(doc, ids)` — removes objects by ID.
- All operations are Y.Doc transactions for CRDT compatibility.

## Keyboard Shortcuts
- `useBoardKeys` hook handles:
  - Arrow keys: nudge selection by 1px (Shift+Arrow = 10px)
  - Delete/Backspace: delete selected objects
  - Escape: clear selection / end edit
  - Ctrl/Cmd+A: select all objects

## Test Hooks
- `testHooks.ts` exposes `window.__vidi6.setCamera` for e2e tests.
- Uses merge pattern (`{ ...existing, setCamera }`) to avoid clobbering other hooks.

## E2E Test Notes
- Board URL format: `/b/:id` (22-char base64url ID).
- Home page requires clicking "New board" button to create a board.
- `setCamera` must be called before interactions to control the viewport.
- Note positions in world space: `createSticky(doc, {x, y})` creates a note centered at (x, y).
- With camera at (-640, -400, zoom=1): screen (sx, sy) → world (sx-640, sy-400).

## Story 8: Per-user Undo/Redo
- `src/client/board/undo.ts` — `createUndo(doc)` wraps `Y.UndoManager`
  with `trackedOrigins: [LOCAL_ORIGIN]` so only the local peer's
  transactions are captured (remote updates never enter history).
- Stale-step safety: before `manager.undo()/redo()`, `popHasEffect()`
  inspects the top step's inverse; if it would be a no-op (targets
  deleted by a colleague) the step is popped manually without applying,
  preventing Yjs's cascade into earlier steps.
- `boundary()` (called at gesture start, editor mount/end, colour
  change, nudge, delete) prevents unrelated changes merging into one
  step; `captureTimeout` (500ms, `UNDO_CAPTURE_TIMEOUT_MS`) groups
  typing bursts; history capped at `UNDO_MAX_STEPS` (200).
- UI: `useUndo` (React binding, subscribes to `stackItems` changes),
  `UndoButtons` in the Toolbar, Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y in
  `useBoardKeys` (and inside the text editor).
- Controller is created in a `useEffect` keyed on `[doc, boardId]`
  (StrictMode-safe: `useMemo` would survive StrictMode's double-invoke
  while the effect cleanup destroys it).
- `useBoardDoc` snapshot cache key includes text + colour so text-only
  edits (e.g. an undone typing burst) refresh the display.
- Tests: `tests/unit/undo-history.test.ts` + `undo-boundaries.test.ts`
  (TC-01..TC-13, fake timers hoisted before yjs import),
  `tests/component/UndoBoundaries.test.tsx` (TC-14..17),
  `tests/component/UndoControls.test.tsx` (TC-18..21),
  `tests/e2e/undo.spec.ts` (TC-22..24).

## E2E Environment Notes (gotchas)
- The wrangler worker serves the **prebuilt** `dist/client` — run
  `npm run build` after client changes before e2e, or tests run
  against a stale bundle.
- A zombie `workerd` process can hold port 8787 without responding
  (Playwright then hangs forever). Find it via `ss -tlnp | grep 8787`
  and `kill -9 <pid>` before re-running.
- Pre-existing e2e failures (verified identical on pre-story-8 code
  14eb533): sticky-notes, navigation, persistence, live-collab,
  nightly-collab, broken-board specs, and share TC-27. They fail on
  `goto('/')`/unknown-board-URL setups that no longer match app
  routing (home page requires clicking "New board").
